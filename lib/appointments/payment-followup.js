/**
 * Whether a customer still has a payment step to complete on an appointment.
 *
 * Used by get-my-reservations, the loader behind /mes-reservations — the
 * customer-facing appointments list. Kept as a standalone helper so the
 * rule stays in one place rather than drifting into the page itself.
 */

/** Payment states that mean "started but not settled". */
const UNSETTLED_PAYMENT_STATUSES = ["PENDING", "FAILED"];

/** Payment types that are collected online, so a Checkout Session applies. */
const ONLINE_PAYMENT_TYPES = ["ONLINE", "DEPOSIT"];

/** Appointment states where chasing a payment no longer makes sense. */
const CLOSED_APPOINTMENT_STATUSES = ["CANCELLED", "COMPLETED"];

/**
 * The customer began an online payment that never completed — an abandoned
 * Checkout, a closed tab, an expired session, a card decline. Resumable via
 * resumeReservationPayment, which mints a fresh Checkout Session against the
 * same Payment row.
 *
 * @param {{ status: string }} appointment
 * @param {{ status: string, paymentType: string } | null} payment
 * @returns {boolean}
 */
export function isAwaitingPayment(appointment, payment) {
  if (!payment) return false;
  if (!UNSETTLED_PAYMENT_STATUSES.includes(payment.status)) return false;
  if (!ONLINE_PAYMENT_TYPES.includes(payment.paymentType)) return false;
  return !CLOSED_APPOINTMENT_STATUSES.includes(appointment.status);
}

/**
 * Staff accepted a manually-confirmed request and the customer has not yet
 * chosen how to pay. No Payment row exists until they choose, so this is
 * distinct from isAwaitingPayment. The acceptance email carries the link;
 * surfacing the same step in the appointment list keeps it reachable when
 * that email is missed.
 *
 * @param {{ status: string }} appointment
 * @param {{ status: string } | null} payment
 * @returns {boolean}
 */
export function isAwaitingPaymentChoice(appointment, payment) {
  return appointment.status === "ACCEPTED" && payment === null;
}
