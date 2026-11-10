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
 * `skipCc` : pas de copie à contact@. `forceCc` : copie même quand NODE_ENV
 * n'est pas « production » (script lancé à la main sur le VPS).
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
  forceCc = false,
}) {
  const reviewToken = createReviewToken({ reservationType, reservationId, email });
  const reviewLink = getAbsoluteUrl(`/nouvel-avis?token=${encodeURIComponent(reviewToken)}`);
  const result = await sendEmail({
    to,
    skipCc,
    forceCc,
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


const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
// Délai avant la demande d'avis, compté depuis la FIN de la prestation :
// 3 heures, pendant que l'expérience est encore fraîche (pratique des
// plateformes de réservation beauté).
const REQUEST_DELAY_MS = 3 * HOUR_MS;
// Au-delà de 14 jours après la prestation, on ne demande plus d'avis. Évite
// aussi de solliciter tout l'historique (ateliers et formations n'ont jamais
// été traités avant le 2026-11-09, la requête plantait sur session.startTime)
// ou un rendez-vous passé en « terminé » des semaines plus tard.
const LOOKBACK_MS = 14 * DAY_MS;

// Un type de prestation par entrée : chacun est interrogé et envoyé dans son
// propre try, une erreur sur l'un n'empêche plus les autres de partir.
function reviewRequestSources(now) {
  const due = new Date(now - REQUEST_DELAY_MS);
  const since = new Date(now - LOOKBACK_MS);
  // Séance terminée depuis 3 h : sa fin, ou son début quand elle n'a pas de
  // fin renseignée (même règle que les inscriptions hors ligne).
  const sessionEnded = {
    startDate: { gte: since },
    OR: [{ endDate: { lt: due } }, { endDate: null, startDate: { lt: due } }],
  };

  return [
    {
      type: "APPOINTMENT",
      label: "appointment",
      model: prisma.appointment,
      where: { status: "COMPLETED", review: null, reviewRequestedAt: null, endTime: { gte: since, lt: due } },
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
      where: { status: "COMPLETED", review: null, reviewRequestedAt: null, session: sessionEnded },
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
      where: { status: "COMPLETED", review: null, reviewRequestedAt: null, session: sessionEnded },
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
 * formation est TERMINÉ depuis au moins 3 heures (et au plus 14 jours), sans
 * avis, et qui n'ont pas encore été sollicitées (reviewRequestedAt vide).
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
