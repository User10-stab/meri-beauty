/**
 * "Relancer le paiement" for atelier and formation bookings — the activity
 * counterpart of resendPaymentEmail (actions/payment/resend-payment-email.js)
 * on appointments.
 *
 * The two domains do not fail the same way. An appointment keeps its Payment
 * row PENDING/FAILED indefinitely, so a relance only has to mint a new link.
 * An activity booking has no Payment row until Stripe confirms: it is a
 * 15-minute seat hold (PENDING_DEPOSIT + holdExpiresAt) that the cron turns
 * into CANCELLED (with no cancelledByUserId) once it lapses unpaid. A relance
 * therefore has to put the seat back on hold for as long as the new link is
 * payable — otherwise the hold-expiry sweep cancels the booking under the
 * client's feet and their payment lands on a cancelled reservation.
 *
 * Deliberately kept out of any "use server" module: every export of such a
 * file is a public POST endpoint.
 */

import { SALON_PAYEE, payeeCheckoutMetadata } from "@/lib/payments/resolve-payee";

export const RELANCE_KINDS = Object.freeze({
  WORKSHOP: "WORKSHOP",
  FORMATION: "FORMATION",
});

// Stripe caps a Checkout Session's lifetime at 24h. The seat hold outlives the
// link by a few minutes so the hold-expiry sweep only ever meets a session
// Stripe has already closed.
export const RELANCE_CHECKOUT_TTL_MS = 23 * 60 * 60 * 1000 + 55 * 60 * 1000;
export const RELANCE_HOLD_TTL_MS = 24 * 60 * 60 * 1000;

const KIND_CONFIG = {
  [RELANCE_KINDS.WORKSHOP]: {
    metadataKind: "workshop",
    actionKey: "workshopAction",
    parentKey: "workshop",
    parentIdKey: "activityId",
    label: "l'atelier",
    successPath: "/reservation-atelier/succes",
    cancelPath: (parent, session) => `/reservation-atelier?canceled=true&activity=${parent.id}&session=${session.id}`,
  },
  [RELANCE_KINDS.FORMATION]: {
    metadataKind: "formation",
    actionKey: "formationAction",
    parentKey: "formation",
    parentIdKey: "formationId",
    label: "la formation",
    successPath: "/reservation-formation/succes",
    cancelPath: (parent, session) => `/reservation-formation?canceled=true&formation=${parent.id}&session=${session.id}`,
  },
};

export function relanceKindConfig(kind) {
  const config = KIND_CONFIG[kind];
  if (!config) throw new Error(`Unknown relance kind: ${kind}`);
  return config;
}

/** What the client owes online today: the whole price, or the deposit. */
export function activityChargeAmount(reservation) {
  const isFullPayment = Number(reservation.balanceDue) === 0;
  return {
    isFullPayment,
    chargeAmount: isFullPayment ? Number(reservation.totalPrice) : Number(reservation.depositAmount),
  };
}

/**
 * Stripe Checkout params for an activity booking. Shared by the public
 * checkout (create-workshop-reservation / create-formation-reservation) and
 * the staff relance, so the webhook sees identical metadata either way.
 *
 * @param {"WORKSHOP"|"FORMATION"} kind
 * @param {object} reservation - with session.{workshop|formation} and customer.{id,email}
 * @param {{ expiresAt?: Date, payee?: import("@/lib/payments/resolve-payee").Payee }} [options]
 *   `payee` decides whose money this seat is. Defaults to the salon so the
 *   older call sites keep their exact behaviour. Pass the SAME payee to
 *   `payeeStripeOptions()` when creating the session — these two have to
 *   agree, or the charge lands on one account while the metadata claims
 *   another and the webhook attributes the Payment to the wrong owner.
 */
export function buildActivityCheckoutParams(kind, reservation, { expiresAt, payee = SALON_PAYEE } = {}) {
  const config = relanceKindConfig(kind);
  const { session } = reservation;
  const parent = session[config.parentKey];
  const { isFullPayment, chargeAmount } = activityChargeAmount(reservation);
  const action = isFullPayment ? "full_payment" : "deposit";
  const sessionDay = new Date(session.startDate).toLocaleDateString("fr-FR", { timeZone: "Europe/Brussels" });
  const seats = `${reservation.seatsCount} place${reservation.seatsCount > 1 ? "s" : ""}`;
  const description = kind === RELANCE_KINDS.FORMATION && parent.type === "PRIVATE"
    ? `Formation individuelle • ${sessionDay}`
    : `${seats} • ${sessionDay}`;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;

  return {
    // A connected account serves its own enabled payment methods, exactly as
    // the appointment checkout does — naming a method the account has not
    // activated is a 400 that kills the whole checkout (iDEAL, 17/09/2026).
    // The salon's own sales keep their explicit, verified list.
    ...(payee.staff ? {} : { payment_method_types: ["card", "bancontact"] }),
    line_items: [
      {
        price_data: {
          currency: "eur",
          product_data: {
            name: `${isFullPayment ? "Paiement total" : "Acompte"} - ${parent.title}`,
            description,
          },
          unit_amount: Math.round(chargeAmount * 100),
        },
        quantity: 1,
      },
    ],
    mode: "payment",
    success_url: `${appUrl}${config.successPath}?reservation_id=${reservation.id}`,
    cancel_url: `${appUrl}${config.cancelPath(parent, session)}`,
    customer_email: reservation.customer.email,
    ...(expiresAt ? { expires_at: Math.floor(expiresAt.getTime() / 1000) } : {}),
    metadata: {
      kind: config.metadataKind,
      [config.actionKey]: action,
      reservationId: reservation.id,
      sessionId: session.id,
      [config.parentIdKey]: parent.id,
      seatsCount: String(reservation.seatsCount),
      totalPrice: String(reservation.totalPrice),
      depositAmount: String(reservation.depositAmount),
      balanceDue: String(reservation.balanceDue),
      customerUserId: reservation.customer.id,
      ...payeeCheckoutMetadata(payee),
    },
    payment_intent_data: {
      metadata: {
        kind: config.metadataKind,
        [config.actionKey]: action,
        reservationId: reservation.id,
        ...payeeCheckoutMetadata(payee),
      },
    },
  };
}

/**
 * Whether staff may relance this booking's online payment. Needs, as
 * selected by the reservation list: status, cancelledByUserId, payment,
 * balanceDue/totalPrice/depositAmount, session.{status,startDate}.
 *
 * - no Payment row: nothing has been collected yet;
 * - PENDING_DEPOSIT (hold live or lapsed), or CANCELLED by nobody — the
 *   hold-expiry sweep. A cancellation a staff member or admin decided
 *   (cancelledByUserId set) is never undone from here;
 * - the session is still scheduled and has not started;
 * - there is actually something to charge.
 *
 * The server action re-checks all of this, plus capacity and Stripe itself.
 */
export function canRelanceActivityPayment(reservation, now = new Date()) {
  if (!reservation || reservation.payment) return false;
  const unpaidHold = reservation.status === "PENDING_DEPOSIT";
  const expiredHold = reservation.status === "CANCELLED" && !reservation.cancelledByUserId;
  if (!unpaidHold && !expiredHold) return false;
  if (reservation.session?.status !== "SCHEDULED") return false;
  if (!reservation.session?.startDate || new Date(reservation.session.startDate) <= now) return false;
  return activityChargeAmount(reservation).chargeAmount > 0;
}
