/**
 * Envoi des campagnes marketing.
 *
 * - getSegmentRecipients(segment) : voir lib/campaigns/segments.js ;
 * - sendCampaign(campaignId) : boucle d'envoi, tracking open/click,
 *   activité `campaign_sent` + promotion `contacte` pour les prospects,
 *   puis status=sent, sentAt=now, totalSenders=nombre de destinataires ;
 * - sendScheduledCampaigns() : appelé par le cron — envoie les campagnes
 *   SCHEDULED dont scheduledDate <= now.
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
  findProspectByEmail,
  addActivity,
  promoteToStatus,
  syncStatusWithSalonActivity,
} from "@/lib/prospects/prospect-service";

export async function sendCampaign(campaignId, { triggeredBy = "manual" } = {}) {
  const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
  if (!campaign) return { success: false, message: "Campagne introuvable." };
  if (campaign.status !== "DRAFT" && campaign.status !== "SCHEDULED") {
    return { success: false, message: "Cette campagne a déjà été envoyée ou annulée." };
  }

  const segment = campaign.targetSegment || "newsletter";
  const recipients = await getSegmentRecipients(isValidSegment(segment) ? segment : "newsletter");

  if (recipients.length === 0) {
    return { success: false, message: "Aucun destinataire pour ce segment." };
  }

  const baseUrl = getAppBaseUrl();

  // Garde-fou local : ton .env a EMAIL_PROVIDER=resend + une vraie clé,
  // donc un envoi de test part VRAIMENT (vrais destinataires). On hurle
  // dans la console plutôt que de bloquer — l'admin assume son clic.
  // (En production, une copie témoin unique part au salon — voir plus bas.)
  if (process.env.NODE_ENV !== "production" && (process.env.EMAIL_PROVIDER || "resend") !== "mailpit") {
    console.warn(
      `[sendCampaign] ENVOI RÉEL en ${process.env.NODE_ENV || "dev"} : ` +
        `"${campaign.title}" va partir à ${recipients.length} vrai(s) destinataire(s) via Resend. ` +
        `Pour tester sans spammer, mets EMAIL_PROVIDER=mailpit dans .env (copie salon désactivée de toute façon).`
    );
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

  for (const recipient of recipients) {
    try {
      const destinationUrl = campaign.ctaUrl
        ? buildDestinationUrl(campaign.ctaUrl, campaign, recipient.email)
        : null;
      const clickTrackingUrl = destinationUrl
        ? buildClickTrackingUrl(baseUrl, {
            campaignId: campaign.id,
            destinationUrl,
            email: recipient.email,
            userId: recipient.userId,
          })
        : null;
      const openTrackingUrl = buildOpenTrackingUrl(baseUrl, {
        campaignId: campaign.id,
        email: recipient.email,
        userId: recipient.userId,
      });
      const unsubscribeUrl = recipient.userId
        ? buildUnsubscribeUrl(baseUrl, recipient.userId)
        : buildProspectUnsubscribeUrl(baseUrl, recipient.email);

      const { subject, text, html } = campaignEmail({
        campaign,
        firstName: recipient.firstName,
        lastName: recipient.lastName,
        company: recipient.company,
        clickTrackingUrl,
        openTrackingUrl,
        unsubscribeUrl,
        baseUrl,
      });

      const result = await sendEmail({
        to: recipient.email,
        subject,
        text,
        html,
        // Jamais de copie salon par destinataire (ni en prod, ni en local).
        skipCc: true,
        ...(attachments.length > 0 ? { attachments } : {}),
      });
      if (!result?.success) throw new Error(result?.error || "Envoi refusé");

      sent += 1;

      // Suivi prospect : activité + promotion vers `contacte` (ne monte que).
      try {
        const prospect = await findProspectByEmail(recipient.email);
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
      console.error(`[sendCampaign] failed to send to ${recipient.email}:`, error?.message ?? error);
    }
  }

  await prisma.campaign.update({
    where: { id: campaign.id },
    data: { status: "SENT", sentAt: new Date(), totalSenders: recipients.length },
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
    total: recipients.length,
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
  settled.forEach((outcome) => {
    if (outcome.status === "fulfilled" && outcome.value?.success) sentCount += 1;
    else if (outcome.status === "rejected") console.error("[sendScheduledCampaigns]", outcome.reason);
  });

  return { checked: due.length, sentCount };
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
