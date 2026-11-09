import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { reviewThankYouEmail } from "@/lib/email-templates";
import { createReviewToken } from "@/lib/review-token";
import { getAbsoluteUrl } from "@/lib/site-url";

/**
 * Envoie UN email de demande d'avis, même lien et même gabarit que la tâche
 * automatique. Utilisé par scripts/relance-avis.mjs.
 *
 * `email` est l'adresse de la cliente liée au jeton ; `to` permet d'envoyer
 * l'email ailleurs (test sur sa propre boîte) sans changer le jeton.
 * `skipCc` : pas de copie à contact@ (une copie par cliente en relance).
 *
 * Lève une erreur si l'envoi échoue : sendEmail ne lève pas, il renvoie
 * { success: false }, et la relance ne doit pas marquer une cliente comme
 * relancée si elle n'a rien reçu.
 */
export async function sendReviewRequestEmail({
  reservationType,
  reservationId,
  email,
  customerName,
  serviceName,
  to = email,
  skipCc = false,
}) {
  const reviewToken = createReviewToken({ reservationType, reservationId, email });
  const reviewLink = getAbsoluteUrl(`/nouvel-avis?token=${encodeURIComponent(reviewToken)}`);
  const result = await sendEmail({
    to,
    skipCc,
    ...reviewThankYouEmail({
      customerName: customerName || "vous",
      serviceName,
      rating: 5,
      reviewLink,
    }),
  });
  if (result && result.success === false) {
    throw new Error(result.error || "envoi de l'email échoué");
  }
  return reviewLink;
}


const DAY_MS = 24 * 60 * 60 * 1000;
// Délai avant la demande d'avis, après la prestation.
const REQUEST_DELAY_MS = 3 * DAY_MS;
// Ateliers et formations : jamais traités avant le 2026-11-09 (la requête
// plantait sur session.startTime). Sans cette fenêtre, la première exécution
// solliciterait toutes les clientes depuis le début. Plus vieux que 14 jours,
// on n'envoie plus rien.
const SESSION_LOOKBACK_MS = 14 * DAY_MS;

// Un type de prestation par entrée : chacun est interrogé et envoyé dans son
// propre try, une erreur sur l'un n'empêche plus les autres de partir.
function reviewRequestSources(now) {
  const due = new Date(now - REQUEST_DELAY_MS);
  const sessionWindow = { gte: new Date(now - SESSION_LOOKBACK_MS), lt: due };

  return [
    {
      type: "APPOINTMENT",
      label: "appointment",
      model: prisma.appointment,
      where: { status: "COMPLETED", review: null, reviewRequestedAt: null, startTime: { lt: due } },
      select: {
        id: true,
        user: { select: { email: true, fullName: true } },
        staffService: { select: { service: { select: { name: true } } } },
      },
      toTarget: (a) => ({
        customer: a.user,
        serviceName: a.staffService?.service?.name ?? "votre rendez-vous",
      }),
    },
    {
      type: "WORKSHOP",
      label: "workshop reservation",
      model: prisma.workshopReservation,
      where: { status: "COMPLETED", review: null, reviewRequestedAt: null, session: { startDate: sessionWindow } },
      select: {
        id: true,
        customer: { select: { email: true, fullName: true } },
        session: { select: { workshop: { select: { title: true } } } },
      },
      toTarget: (r) => ({
        customer: r.customer,
        serviceName: r.session?.workshop?.title ?? "atelier",
      }),
    },
    {
      type: "FORMATION",
      label: "formation reservation",
      model: prisma.formationReservation,
      where: { status: "COMPLETED", review: null, reviewRequestedAt: null, session: { startDate: sessionWindow } },
      select: {
        id: true,
        customer: { select: { email: true, fullName: true } },
        session: { select: { formation: { select: { title: true } } } },
      },
      toTarget: (r) => ({
        customer: r.customer,
        serviceName: r.session?.formation?.title ?? "formation",
      }),
    },
    // Commandes boutique : volontairement absentes. Un avis de commande n'est
    // pas enregistré aujourd'hui (Review n'a pas de colonne commande, voir
    // submitReviewWithToken) — envoyer le lien ferait perdre l'avis.
  ];
}

/**
 * Envoie la demande d'avis aux clientes dont le rendez-vous / atelier /
 * formation est TERMINÉ depuis au moins 3 jours, sans avis, et qui n'ont
 * pas encore été sollicitées (reviewRequestedAt vide). Ateliers et
 * formations : seulement les séances des 14 derniers jours.
 */
export async function sendReviewRequests() {
  const now = Date.now();
  let sentCount = 0;

  for (const source of reviewRequestSources(now)) {
    let rows;
    try {
      rows = await source.model.findMany({ where: source.where, select: source.select });
    } catch (err) {
      console.error(`[background-jobs] Review requests: failed to load ${source.label}s:`, err);
      continue;
    }

    for (const row of rows) {
      const { customer, serviceName } = source.toTarget(row);
      if (!customer?.email) continue;

      try {
        await sendReviewRequestEmail({
          reservationType: source.type,
          reservationId: row.id,
          email: customer.email,
          customerName: customer.fullName,
          serviceName,
        });
        await source.model.update({
          where: { id: row.id },
          data: { reviewRequestedAt: new Date() },
        });
        sentCount++;
        console.log("[background-jobs] Review request email sent to", customer.email, "for", source.label, row.id);
      } catch (err) {
        console.error(
          "[background-jobs] Failed to send review request email to",
          customer.email,
          ":",
          err.message
        );
      }
    }
  }

  return { sentCount };
}
