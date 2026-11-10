import { randomUUID } from "node:crypto";
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

const MAX_ATTEMPTS = 3;
const LEASE_MS = 2 * 60_000;
const RUN_BUDGET_MS = 45_000;

async function claimCampaign(id, triggeredBy) {
  const now = new Date();
  const leaseToken = randomUUID();
  const eligible = triggeredBy === "manual"
    ? { OR: [{ queuedAt: null }, { scheduledDate: { lte: now } }] }
    : { status: "SCHEDULED", scheduledDate: { lte: now } };

  return prisma.$transaction(async (tx) => {
    const claimed = await tx.campaign.updateMany({
      where: {
        id,
        status: { in: ["DRAFT", "SCHEDULED"] },
        AND: [eligible, { OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }] }],
      },
      data: { status: "SCHEDULED", scheduledDate: now, leaseToken, leaseUntil: new Date(+now + LEASE_MS) },
    });
    if (!claimed.count) return null;

    // The old worker may have submitted these messages before it stopped.
    await tx.campaignRecipient.updateMany({
      where: { campaignId: id, status: "SENDING" },
      data: { status: "UNKNOWN", error: "Envoi interrompu : acceptation SMTP indéterminée." },
    });
    return tx.campaign.findUnique({ where: { id } });
  });
}

export async function sendCampaign(campaignId, { triggeredBy = "manual" } = {}) {
  const startedAt = Date.now();
  const campaign = await claimCampaign(campaignId, triggeredBy);
  if (!campaign) {
    return { success: true, skipped: true, message: "Campagne non disponible pour un envoi immédiat." };
  }

  const owner = { id: campaignId, leaseToken: campaign.leaseToken, status: "SCHEDULED" };
  const segment = isValidSegment(campaign.targetSegment) ? campaign.targetSegment : "newsletter";
  const baseUrl = getAppBaseUrl();
  const detailsList = await getSegmentRecipients(segment);
  const detailsByEmail = new Map(detailsList.map((row) => [row.email, row]));

  if (!campaign.queuedAt) {
    if (detailsList.length === 0) {
      await prisma.campaign.updateMany({
        where: owner,
        data: { status: "DRAFT", scheduledDate: null, leaseToken: null, leaseUntil: null },
      });
      return { success: false, message: "Aucun destinataire pour ce segment." };
    }
    const initialized = await prisma.$transaction(async (tx) => {
      const snapshot = await tx.campaign.updateMany({
        where: { ...owner, queuedAt: null },
        data: { queuedAt: new Date(), totalSenders: detailsList.length },
      });
      if (!snapshot.count) return false;
      await tx.campaignRecipient.createMany({
        data: detailsList.map(({ email, userId }) => ({ campaignId, email, userId })),
        skipDuplicates: true,
      });
      return true;
    });
    if (!initialized) return { success: true, skipped: true };
  }

  const batch = await prisma.campaignRecipient.findMany({
    where: { campaignId, status: "PENDING", nextAttemptAt: { lte: new Date() } },
    orderBy: [{ nextAttemptAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
  });

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
  let pausedUntil;
  let processed = 0;

  for (const row of batch) {
    if (processed > 0 && Date.now() - startedAt >= RUN_BUDGET_MS) break;
    processed++;
    const info = detailsByEmail.get(row.email) || { email: row.email, firstName: null, lastName: null, company: null, userId: row.userId };
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

    let sending = false;
    async function beforeSubmit() {
      sending = await prisma.$transaction(async (tx) => {
        const lease = await tx.campaign.updateMany({
          where: owner,
          data: { leaseUntil: new Date(Date.now() + LEASE_MS) },
        });
        if (!lease.count) return false;
        const changed = await tx.campaignRecipient.updateMany({
          where: { id: row.id, status: "PENDING" },
          data: { status: "SENDING" },
        });
        return changed.count === 1;
      });
      return sending;
    }

    const result = await sendEmail({
      to: row.email,
      subject,
      text,
      html,
      skipCc: true,
      beforeSubmit,
      messageId: `<campaign-${row.id}@meribeautystudio.com>`,
      ...(attachments.length > 0 ? { attachments } : {}),
    }).catch((error) => ({ success: false, kind: "unknown", error: error.message }));

    if (result.kind === "cancelled") return { success: true, skipped: true };
    if (result.kind === "quota") {
      pausedUntil = result.retryAt;
      break;
    }

    const attempts = row.attempts + 1;
    let data;
    if (result.success) {
      data = { status: "SENT", attempts, error: null, sentAt: new Date() };
    } else {
      const retry = result.kind === "temporary" && attempts < MAX_ATTEMPTS;
      const retryAt = new Date(Date.now() + 5 * 60_000 * 2 ** (attempts - 1));
      if (result.rateLimited) pausedUntil = retryAt;
      data = {
        status: retry ? "PENDING" : result.kind === "unknown" ? "UNKNOWN" : "FAILED",
        attempts,
        error: String(result.error || "Envoi refusé").slice(0, 500),
        ...(retry ? { nextAttemptAt: retryAt } : {}),
      };
    }
    const saved = await prisma.campaignRecipient.updateMany({
      where: {
        id: row.id,
        status: sending ? "SENDING" : "PENDING",
        campaign: { leaseToken: owner.leaseToken },
      },
      data,
    });
    if (!saved.count) return { success: true, skipped: true };
    if (pausedUntil) break;
    if (!result.success) continue;
    sent++;

    try {
      // Suivi prospect : activité + promotion vers `contacte` (ne monte que).
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
    } catch (error) {
      console.error("[sendCampaign] prospect tracking failed:", error);
    }
  }

  const [next, queued, sentCount, failed, unknown] = await Promise.all([
    prisma.campaignRecipient.findFirst({
      where: { campaignId, status: "PENDING" },
      orderBy: { nextAttemptAt: "asc" },
      select: { nextAttemptAt: true },
    }),
    prisma.campaignRecipient.count({ where: { campaignId, status: "PENDING" } }),
    prisma.campaignRecipient.count({ where: { campaignId, status: "SENT" } }),
    prisma.campaignRecipient.count({ where: { campaignId, status: "FAILED" } }),
    prisma.campaignRecipient.count({ where: { campaignId, status: "UNKNOWN" } }),
  ]);

  const release = { sentCount, leaseToken: null, leaseUntil: null };
  if (next) {
    const resumeAt = pausedUntil ?? next.nextAttemptAt;
    await prisma.campaign.updateMany({ where: owner, data: { ...release, scheduledDate: resumeAt } });
    return { success: true, sent, failed, unknown, queued, resumeAt, message: "Campagne en cours. Reprise automatique." };
  }

  if (failed || unknown) {
    await prisma.campaign.updateMany({
      where: owner,
      data: { ...release, status: "FAILED", scheduledDate: null },
    });
    return {
      success: false, sent, failed, unknown,
      message: `Campagne terminée avec ${failed} échec(s) et ${unknown} envoi(s) à vérifier.`,
    };
  }

  // Copie témoin unique au salon — PRODUCTION uniquement, jamais en local.
  // Volontairement SANS pixel ni lien tracké : l'ouverture/clic du salon
  // ne doit pas gonfler openedCount/clickedCount. Le sujet est préfixé
  // pour la distinguer dans la boîte de réception.
  let proofCopy = false;
  if (process.env.NODE_ENV === "production" && !campaign.proofStartedAt) {
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
        beforeSubmit: async () => {
          const proofClaim = await prisma.campaign.updateMany({
            where: { ...owner, proofStartedAt: null },
            data: { proofStartedAt: new Date(), leaseUntil: new Date(Date.now() + LEASE_MS) },
          });
          return proofClaim.count === 1;
        },
        ...(attachments.length > 0 ? { attachments } : {}),
      });
      if (proofResult.kind === "quota") {
        const resumeAt = proofResult.retryAt;
        await prisma.campaign.updateMany({
          where: owner,
          data: { ...release, scheduledDate: resumeAt },
        });
        return { success: true, sent, queued: 1, resumeAt, message: "Destinataires traités. Copie salon en attente." };
      }
      proofCopy = !!proofResult?.success;
      if (!proofCopy) console.error("[sendCampaign] copie salon non envoyée:", proofResult?.error);
    } catch (proofError) {
      console.error("[sendCampaign] copie salon échouée:", proofError?.message ?? proofError);
    }
  }

  await prisma.campaign.updateMany({
    where: owner,
    data: { ...release, status: "SENT", sentAt: new Date(), scheduledDate: null },
  });

  return {
    success: true,
    message: `Campagne envoyée : ${sentCount} e-mail(s).`,
    sent,
    failed,
    attachmentMissing,
    proofCopy,
  };
}

export async function sendScheduledCampaigns() {
  const due = await prisma.campaign.findMany({
    where: {
      status: "SCHEDULED",
      scheduledDate: { lte: new Date() },
      OR: [{ leaseUntil: null }, { leaseUntil: { lte: new Date() } }],
    },
    orderBy: { scheduledDate: "asc" },
    select: { id: true },
    take: 20,
  });

  const settled = await Promise.allSettled(
    due.map(({ id }) => sendCampaign(id, { triggeredBy: "scheduled" }))
  );

  let sentCount = 0;
  let queuedCount = 0;
  settled.forEach((outcome) => {
    if (outcome.status === "fulfilled" && outcome.value?.success && !outcome.value.skipped) {
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
