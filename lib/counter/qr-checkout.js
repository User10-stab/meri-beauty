import { stripe } from "@/lib/stripe";
import { roundMoney } from "@/lib/tax-policy";

/**
 * « Carte QR » at the counter: the client pays an exact amount on their own
 * phone, at the till (2026-09-21).
 *
 * The retail till has had this since the POS was built — createPointOfSaleSale
 * returns a checkoutUrl, CounterCart renders it as a QR and polls the order.
 * « Pointage & encaissement » only ever offered Espèces and Terminal externe,
 * so the same client standing at the same counter could pay by QR for a
 * lipstick but not for the balance of their formation.
 *
 * WHY THIS IS NOT THE ONLINE CHECKOUT
 *
 * The public checkout (buildActivityCheckoutParams) charges a booking's
 * deposit or its full price, because that is what a client pays when they
 * book. It has no notion of "the 40 € still owed at the door", and neither
 * does the webhook, which understands deposit / full_payment / change-fee and
 * nothing else. So the counter needs its own session: an exact amount, tied
 * to one booking, that settles through the counter's own path.
 *
 * WHO SETTLES IT
 *
 * The counter does, not the webhook. Once Stripe says the session is paid,
 * the settle action the operator was already using runs as it always has —
 * same ticket allocation, same invoice rules, same off-till and independent
 * guards — with the QR standing in for the « j'ai bien reçu » attestation.
 * That attestation is the weakest part of a cash or terminal collection: it
 * is a human ticking a box. Here the server asks Stripe directly, so the
 * evidence is stronger than the thing it replaces.
 *
 * Deliberately stores nothing. The session's own metadata names the booking,
 * so a payment whose operator walked away before it settled is still
 * discoverable from Stripe — the same way reconcileMissedCheckouts already
 * finds abandoned POS orders — without another column to migrate.
 *
 * Not a "use server" module: it moves money, so it is reachable only through
 * the auth-gated actions that import it.
 */

export const COUNTER_QR_METHOD = "CARD_QR";

/** Whether this counter settlement is paid by QR on the client's phone. */
export function isCounterQr(method) {
  return method === COUNTER_QR_METHOD;
}

/** The counter's QR sessions are short-lived: the client is standing there. */
export const COUNTER_QR_TTL_MS = 30 * 60 * 1000;

/**
 * Stripe's minimum charge is 0,50 €, and a session for less is a 400 that
 * kills the modal with an opaque error.
 */
export const COUNTER_QR_MINIMUM = 0.5;

export const COUNTER_QR_SURFACES = Object.freeze({
  APPOINTMENT: "appointment",
  WORKSHOP: "workshop",
  FORMATION: "formation",
  ORDER: "order",
});

const SURFACE_VALUES = new Set(Object.values(COUNTER_QR_SURFACES));

/**
 * `kind: "counter_qr"` keeps these out of the webhook's dispatch, which
 * branches on metadata.kind — a counter session must NOT be mistaken for the
 * online booking flows it deliberately does not reuse.
 */
export function buildCounterQrParams({ surface, targetId, amount, customerEmail, label, expiresAt }) {
  const metadata = {
    kind: "counter_qr",
    surface,
    targetId,
    // The amount is pinned in metadata as well as in the line item so the
    // verification below can refuse a session that was built for a different
    // price than the one now being settled (a price adjusted after the QR
    // was shown, for instance).
    amount: String(roundMoney(amount)),
  };

  return {
    // The salon's own sales only — an independent's booking never reaches
    // here (see the off-till guards), so this is always the platform account
    // and its verified method list.
    payment_method_types: ["card", "bancontact"],
    line_items: [
      {
        price_data: {
          currency: "eur",
          product_data: { name: label },
          unit_amount: Math.round(roundMoney(amount) * 100),
        },
        quantity: 1,
      },
    ],
    mode: "payment",
    // The client pays on their phone and hands it back; the counter's modal
    // is what reports success, so these pages are only ever glanced at.
    success_url: `${process.env.NEXT_PUBLIC_APP_URL}/paiement/comptoir/merci`,
    cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/paiement/comptoir/annule`,
    ...(customerEmail ? { customer_email: customerEmail } : {}),
    expires_at: Math.floor(expiresAt.getTime() / 1000),
    metadata,
    payment_intent_data: { metadata },
  };
}

/**
 * Asks Stripe whether this session was really paid, for really this booking
 * and really this amount. Every settle path calls it before recording a
 * centime: the client supplies the session id, so nothing it says may be
 * trusted on its own.
 *
 * @returns {Promise<{ paid: boolean, reason?: string, paymentIntentId?: string|null, amount?: number }>}
 */
export async function verifyCounterQrPayment(sessionId, { surface, targetId, amount }) {
  if (!sessionId || typeof sessionId !== "string") return { paid: false, reason: "COUNTER_QR_SESSION_MISSING" };
  if (!SURFACE_VALUES.has(surface)) return { paid: false, reason: "COUNTER_QR_SURFACE_UNKNOWN" };

  let session;
  try {
    session = await stripe.checkout.sessions.retrieve(sessionId);
  } catch (error) {
    console.error("[verifyCounterQrPayment]", error);
    return { paid: false, reason: "COUNTER_QR_UNREADABLE" };
  }

  if (session.metadata?.kind !== "counter_qr") return { paid: false, reason: "COUNTER_QR_NOT_A_COUNTER_SESSION" };
  // A session belonging to another booking must never settle this one.
  if (session.metadata?.surface !== surface || session.metadata?.targetId !== targetId) {
    return { paid: false, reason: "COUNTER_QR_WRONG_TARGET" };
  }
  if (session.payment_status !== "paid") return { paid: false, reason: "COUNTER_QR_NOT_PAID" };

  // What Stripe actually took, compared with what is about to be recorded.
  const paidAmount = roundMoney((session.amount_total ?? 0) / 100);
  if (Math.abs(paidAmount - roundMoney(amount)) > 0.001) {
    return { paid: false, reason: "COUNTER_QR_AMOUNT_CHANGED", amount: paidAmount };
  }

  return {
    paid: true,
    amount: paidAmount,
    paymentIntentId: typeof session.payment_intent === "string" ? session.payment_intent : (session.payment_intent?.id ?? null),
  };
}

export const COUNTER_QR_MESSAGES = {
  COUNTER_QR_SESSION_MISSING: "Aucun paiement par QR à valider.",
  COUNTER_QR_SURFACE_UNKNOWN: "Ce type de vente n'accepte pas le paiement par QR.",
  COUNTER_QR_UNREADABLE: "Impossible de vérifier ce paiement auprès de Stripe. Réessayez.",
  COUNTER_QR_NOT_A_COUNTER_SESSION: "Ce paiement ne vient pas de la caisse.",
  COUNTER_QR_WRONG_TARGET: "Ce paiement concerne une autre vente.",
  COUNTER_QR_NOT_PAID: "Le paiement par QR n'est pas encore confirmé.",
  COUNTER_QR_AMOUNT_CHANGED: "Le montant payé ne correspond plus au montant dû. Vérifiez avant d'encaisser.",
  COUNTER_QR_BELOW_MINIMUM: "Le paiement par QR exige au moins 0,50 €.",
  COUNTER_QR_INDEPENDENT: "Cette vente appartient à une indépendante : le salon n'encaisse pas son paiement.",
};
