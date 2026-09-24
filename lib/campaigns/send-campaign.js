/**
 * Envoi des campagnes marketing — AVEC file d'attente et quota journalier.
 *
 * Contexte : Resend gratuit = 100 e-mails/jour (quota PARTAGÉ avec le
 * transactionnel, voir lib/campaigns/email-quota.js).
 *
 * Exemple : 150 prospects, quota restant 100.
 *   Jour J     : 100 envoyés, 50 restent PENDING, campagne SCHEDULED (reprise +24h).
 *   Jour J+1   : le cron reprend la file, envoie les 50, campagne SENT.
 *
 * - sendCampaign(campaignId) : construit la file au 1er passage (un
 *   CampaignRecipient PENDING par destinataire, totalSenders = taille),
 *   envoie une tranche ≤ quota restant, puis clôture (SENT + copie salon)
 *   ou replanifie (SCHEDULED + scheduledDate = lendemain).
 * - Les FAILED (attempts < 3) sont réessayés le lendemain ; au-delà,
 *   on arrête d'insister (adresse en erreur durable).
 * - sendScheduledCampaigns() : appelé par le cron — reprend les files.
 */

import { prisma } from "@/lib/prisma";
import { sendEmail, INTERNAL_COPY_ADDRESS } from "@/lib/email";
import { getAppBaseUrl } from "@/lib/site-url";
import { buildUnsubscribeUrl } from "@/lib/newsletter-consent";
import { getSegmentRecipients, isValidSegment } from "@/lib/campaigns/segments";
import {
  buildDestinationUrl,
  buildClickTrackingUrl,
  buildOpenTrackingUrl,
  campaignEmail,
} from "@/lib/campaigns/campaign-email";
import { buildProspectUnsubscribeUrl } from "@/lib/campaigns/campaign-unsubscribe";
import { resolveCampaignAttachment } from "@/lib/campaigns/campaign-attachment";
import {
  remainingQuota,
  computeBatchSize,
  nextResumeAt,
} from "@/lib/campaigns/email-quota";
import {
  findProspectByEmail,
  addActivity,
  promoteToStatus,
  syncStatusWithSalonActivity,
} from "@/lib/prospects/prospect-service";

const MAX_ATTEMPTS = 3;

export async function sendCampaign(campaignId, { triggeredBy = "manual" } = {}) {
  const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
  if (!campaign) return { success: false, message: "Campagne introuvable." };
  if (campaign.status !== "DRAFT" && campaign.status !== "SCHEDULED") {
    return { success: false, message: "Cette campagne a déjà été envoyée ou annulée." };
  }

  const segment = campaign.targetSegment || "newsletter";
  const baseUrl = getAppBaseUrl();

  // ── 1. File d'attente ──────────────────────────────────────────────
  // Rien d'envoyé encore (sentCount===0) -> (re)construit depuis le
  // segment du moment (un changement de segment avant le 1er envoi est
  // donc pris en compte). Sinon on reprend la file existante.
  let queueSize = await prisma.campaignRecipient.count({ where: { campaignId: campaign.id } });
  if (campaign.sentCount === 0) {
    const recipients = await getSegmentRecipients(isValidSegment(segment) ? segment : "newsletter");
    if (recipients.length === 0 && queueSize === 0) {
      return { success: false, message: "Aucun destinataire pour ce segment." };
    }
    if (recipients.length > 0) {
      await prisma.campaignRecipient.deleteMany({ where: { campaignId: campaign.id } });
      await prisma.campaignRecipient.createMany({
        data: recipients.map((r) => ({ campaignId: campaign.id, email: r.email, userId: r.userId })),
        skipDuplicates: true,
      });
      queueSize = recipients.length;
      await prisma.campaign.update({
        where: { id: campaign.id },
        data: { totalSenders: recipients.length, sentCount: 0 },
      });
    }

    // Garde-fou local : EMAIL_PROVIDER=resend + vraie clé = envoi RÉEL.
    if (process.env.NODE_ENV !== "production" && (process.env.EMAIL_PROVIDER || "resend") !== "mailpit") {
      console.warn(
        `[sendCampaign] ENVOI RÉEL en ${process.env.NODE_ENV || "dev"} : ` +
          `"${campaign.title}" va partir à ${queueSize} vrai(s) destinataire(s) via Resend. ` +
          `Pour tester sans spammer, mets EMAIL_PROVIDER=mailpit dans .env.`
      );
    }
  }

  // Détails destinataires (prénom/nom/société pour le Bonjour) — frais à
  // chaque tranche, indexés par email.
  const detailsList = await getSegmentRecipients(isValidSegment(segment) ? segment : "newsletter");
  const detailsByEmail = new Map(detailsList.map((r) => [r.email, r]));

  // ── 2. Tranche du jour (quota restant) ─────────────────────────────
  const quota = await remainingQuota();
  const pending = await prisma.campaignRecipient.findMany({
    where: { campaignId: campaign.id, status: { in: ["PENDING", "FAILED"] }, attempts: { lt: MAX_ATTEMPTS } },
    orderBy: { createdAt: "asc" },
  });
  const batch = pending.slice(0, computeBatchSize(quota, pending.length));

  if (batch.length === 0 && pending.length > 0) {
    // Quota du jour épuisé -> on replanifie demain, sans rien perdre.
    const resumeAt = nextResumeAt();
    await prisma.campaign.update({
      where: { id: campaign.id },
      data: { status: "SCHEDULED", scheduledDate: resumeAt },
    });
    return {
      success: true,
      sent: 0,
      failed: 0,
      total: queueSize,
      queued: pending.length,
      resumeAt,
      message: `Quota du jour épuisé : ${pending.length} e-mail(s) en attente, reprise automatique ${resumeAt.toLocaleDateString("fr-BE")}.`,
    };
  }

  // Pièce jointe résolue UNE fois (pas à chaque destinataire). Si elle est
  // configurée mais illisible, l'envoi continue sans elle et le signale —
  // mieux que de bloquer toute la campagne.
  let attachments = [];
  let attachmentMissing = false;
  if (campaign.attachmentUrl) {
    const resolved = await resolveCampaignAttachment(campaign.attachmentUrl, { filenameHint: campaign.title });
    if (resolved) {
      attachments = [resolved];
    } else {
      attachmentMissing = true;
      console.error(`[sendCampaign] pièce jointe illisible, envoi sans : ${campaign.attachmentUrl}`);
    }
  }

  let sent = 0;
  let failed = 0;

  for (const row of batch) {
    const info = detailsByEmail.get(row.email) || { email: row.email, firstName: null, lastName: null, company: null, userId: row.userId };
    try {
      const destinationUrl = campaign.ctaUrl
        ? buildDestinationUrl(campaign.ctaUrl, campaign, row.email)
        : null;
      const clickTrackingUrl = destinationUrl
        ? buildClickTrackingUrl(baseUrl, {
            campaignId: campaign.id,
            destinationUrl,
            email: row.email,
            userId: row.userId,
          })
        : null;
      const openTrackingUrl = buildOpenTrackingUrl(baseUrl, {
        campaignId: campaign.id,
        email: row.email,
        userId: row.userId,
      });
      const unsubscribeUrl = row.userId
        ? buildUnsubscribeUrl(baseUrl, row.userId)
        : buildProspectUnsubscribeUrl(baseUrl, row.email);

      const { subject, text, html } = campaignEmail({
        campaign,
        firstName: info.firstName,
        lastName: info.lastName,
        company: info.company,
        clickTrackingUrl,
        openTrackingUrl,
        unsubscribeUrl,
        baseUrl,
      });

      const result = await sendEmail({
        to: row.email,
        subject,
        text,
        html,
        // Jamais de copie salon par destinataire (ni en prod, ni en local).
        skipCc: true,
        ...(attachments.length > 0 ? { attachments } : {}),
      });
      if (!result?.success) throw new Error(result?.error || "Envoi refusé");

      sent += 1;
      await prisma.campaignRecipient.update({
        where: { id: row.id },
        data: { status: "SENT", attempts: { increment: 1 }, error: null, sentAt: new Date() },
      });

      // Suivi prospect : activité + promotion vers `contacte` (ne monte que).
      try {
        const prospect = await findProspectByEmail(row.email);
        if (prospect) {
          await addActivity(prospect, {
            type: "campaign_sent",
            campaignId: campaign.id,
            metadata: { segment, triggeredBy },
            description: `Campagne envoyée : ${campaign.title}`,
          });
          await promoteToStatus(prospect, "contacte", { note: `Campagne : ${campaign.title}` });
        }
      } catch (trackError) {
        console.error("[sendCampaign] prospect tracking failed:", trackError);
      }
    } catch (error) {
      failed += 1;
      console.error(`[sendCampaign] failed to send to ${row.email}:`, error?.message ?? error);
      await prisma.campaignRecipient.update({
        where: { id: row.id },
        data: { status: "FAILED", attempts: { increment: 1 }, error: String(error?.message ?? error).slice(0, 500) },
      }).catch(() => {});
    }
  }

  if (sent > 0) {
    await prisma.campaign.update({
      where: { id: campaign.id },
      data: { sentCount: { increment: sent } },
    });
  }

  // ── 3. Clôture ou replanification ──────────────────────────────────
  const left = await prisma.campaignRecipient.count({
    where: { campaignId: campaign.id, status: { in: ["PENDING", "FAILED"] }, attempts: { lt: MAX_ATTEMPTS } },
  });

  if (left > 0) {
    const resumeAt = nextResumeAt();
    await prisma.campaign.update({
      where: { id: campaign.id },
      data: { status: "SCHEDULED", scheduledDate: resumeAt },
    });
    return {
      success: true,
      sent,
      failed,
      total: queueSize,
      queued: left,
      resumeAt,
      attachmentMissing,
      message: `Tranche envoyée : ${sent} e-mail(s)${failed ? `, ${failed} échec(s)` : ""}. ${left} restant(s) — reprise automatique ${resumeAt.toLocaleDateString("fr-BE")}.`,
    };
  }

  await prisma.campaign.update({
    where: { id: campaign.id },
    data: { status: "SENT", sentAt: new Date(), totalSenders: queueSize },
  });

  // Copie témoin unique au salon — PRODUCTION uniquement, jamais en local.
  // Volontairement SANS pixel ni lien tracké : l'ouverture/clic du salon
  // ne doit pas gonfler openedCount/clickedCount. Le sujet est préfixé
  // pour la distinguer dans la boîte de réception.
  let proofCopy = false;
  if (process.env.NODE_ENV === "production") {
    try {
      const proofDestination = campaign.ctaUrl
        ? buildDestinationUrl(campaign.ctaUrl, campaign, INTERNAL_COPY_ADDRESS)
        : null;
      const proof = campaignEmail({
        campaign,
        firstName: null,
        lastName: null,
        company: null,
        clickTrackingUrl: proofDestination,
        openTrackingUrl: null,
        unsubscribeUrl: null,
        baseUrl,
      });
      const proofResult = await sendEmail({
        to: INTERNAL_COPY_ADDRESS,
        subject: `[Copie salon] ${proof.subject}`,
        text: proof.text,
        html: proof.html,
        skipCc: true,
        ...(attachments.length > 0 ? { attachments } : {}),
      });
      proofCopy = !!proofResult?.success;
      if (!proofCopy) console.error("[sendCampaign] copie salon non envoyée:", proofResult?.error);
    } catch (proofError) {
      console.error("[sendCampaign] copie salon échouée:", proofError?.message ?? proofError);
    }
  }

  return {
    success: true,
    message: `Campagne envoyée : ${sent} e-mail(s), ${failed} échec(s).${attachmentMissing ? " (pièce jointe manquante — envoyée sans)" : ""}${proofCopy ? " (copie salon envoyée)" : ""}`,
    sent,
    failed,
    total: queueSize,
    queued: 0,
    attachmentMissing,
    proofCopy,
  };
}

/**
 * Claim atomique d'une campagne planifiée (anti double-envoi).
 *
 * Le scheduler tourne à deux endroits (intervalle in-process +
 * /api/cron) qui peuvent se chevaucher : sans claim, deux runners
 * prendraient la même campagne et les clients recevraient tout en
 * double. Le claim repousse scheduledDate de `leaseMinutes` en UNE
 * requête atomique — seul le gagnant (count===1) envoie.
 * En cas de crash après le claim, la campagne reste SCHEDULED avec un
 * bail expirant : elle sera reprise au tick suivant, jamais perdue.
 *
 * @returns {Promise<boolean>} true si ce runner a gagné le claim.
 */
export async function claimScheduledCampaign(campaignId, leaseMinutes = 10) {
  const claimed = await prisma.campaign.updateMany({
    where: {
      id: campaignId,
      status: "SCHEDULED",
      scheduledDate: { lte: new Date() },
    },
    data: { scheduledDate: new Date(Date.now() + leaseMinutes * 60 * 1000) },
  });
  return claimed.count === 1;
}

/**
 * Cron : envoie les campagnes SCHEDULED dont la date est atteinte.
 * Idempotent par statut (DRAFT/SCHEDULED -> SENT en fin d'envoi).
 */
export async function sendScheduledCampaigns() {
  const due = await prisma.campaign.findMany({
    where: { status: "SCHEDULED", scheduledDate: { lte: new Date() } },
    select: { id: true },
    take: 20,
  });

  const settled = await Promise.allSettled(
    due.map(async ({ id }) => {
      // Perdu le claim (un autre runner l'envoie) -> on saute, sans erreur.
      if (!(await claimScheduledCampaign(id))) {
        return { success: true, skipped: "claimed by another runner" };
      }
      return sendCampaign(id, { triggeredBy: "scheduled" });
    })
  );

  let sentCount = 0;
  let queuedCount = 0;
  settled.forEach((outcome) => {
    if (outcome.status === "fulfilled" && outcome.value?.success) {
      sentCount += 1;
      queuedCount += outcome.value?.queued ?? 0;
    } else if (outcome.status === "rejected") console.error("[sendScheduledCampaigns]", outcome.reason);
  });

  return { checked: due.length, sentCount, queuedCount };
}

/**
 * Resync utilitaire : recale le statut des prospects ayant une activité
 * salon (appelé ponctuellement depuis la fiche prospect / un job).
 */
export async function resyncProspect(prospectId) {
  const prospect = await prisma.prospect.findUnique({ where: { id: prospectId } });
  if (!prospect) return null;
  return syncStatusWithSalonActivity(prospect, { note: "Resynchronisation manuelle" });
}
