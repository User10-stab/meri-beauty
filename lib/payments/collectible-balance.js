/**
 * lib/payments/collectible-balance.js
 *
 * Single source of truth for "how much money is still collectible on this
 * record, right now".
 *
 * `Payment.remainingAmount` is NOT that number. It is the unpaid part of the
 * original payment plan (totalAmount - paidAmount at the time the plan was
 * built), and it deliberately survives untouched through cancellation and
 * refund so the audit trail keeps showing what the plan was. A refund never
 * rewrites paidAmount/remainingAmount either — settle-leg only moves
 * Payment.status to REFUNDED / PARTIALLY_REFUNDED (see
 * lib/refunds/settle-leg.js refreshPaymentStatus).
 *
 * Reading remainingAmount directly is therefore how a refunded transaction
 * ended up telling staff "Solde à encaisser : 40 €" on a booking nobody owes
 * anything on. Four screens each had their own copy of the correction; this
 * module is the one they now share, so the rule can only change in one place.
 */

/**
 * Lifecycle statuses (appointment / reservation / order) after which nothing
 * is collectible: the thing being paid for is not going to happen.
 *
 * COMPLETED and NO_SHOW are deliberately absent — a completed service or a
 * forfeited no-show can legitimately still carry an unpaid balance.
 */
export const NON_COLLECTIBLE_LIFECYCLE_STATUSES = Object.freeze([
  "CANCELLED",
  "REJECTED",
  "EXPIRED",
  // A boutique order taken over by the till: its balance was collected on
  // the counter sale that replaced it, never on the order itself.
  "SETTLED_AT_COUNTER",
]);

/**
 * Payment statuses after which nothing is collectible.
 *
 * REFUND_PENDING / REFUND_FAILED are included alongside REFUNDED on purpose:
 * both mean a refund has been *decided* on this payment. Money is on its way
 * back out, so presenting the historical plan balance as due would have staff
 * collecting on a record that is being unwound.
 *
 * PARTIALLY_REFUNDED is deliberately absent. A partial refund gives back part
 * of what was already paid; it does not touch the unpaid part of the plan, and
 * it is not a reason to re-collect the refunded amount either.
 */
export const NON_COLLECTIBLE_PAYMENT_STATUSES = Object.freeze([
  "REFUNDED",
  "REFUND_PENDING",
  "REFUND_FAILED",
]);

/**
 * @param {{ paymentStatus?: string|null, lifecycleStatus?: string|null }} input
 * @returns {boolean} whether a balance on this record may still be collected
 */
export function isBalanceCollectible({ paymentStatus = null, lifecycleStatus = null } = {}) {
  if (paymentStatus && NON_COLLECTIBLE_PAYMENT_STATUSES.includes(paymentStatus)) return false;
  if (lifecycleStatus && NON_COLLECTIBLE_LIFECYCLE_STATUSES.includes(lifecycleStatus)) return false;
  return true;
}

/**
 * The amount actually still due on a record.
 *
 * Pass the payment's own status and the status of whatever the payment is
 * for (appointment, workshop/formation reservation, order) — both matter, and
 * either alone gets it wrong: a cancelled reservation can have a PAID payment,
 * and a refunded payment can hang off a still-CONFIRMED booking.
 *
 * @param {{
 *   remainingAmount?: number|string|null,
 *   paymentStatus?: string|null,
 *   lifecycleStatus?: string|null,
 * }} input
 * @returns {number} never negative, 0 when nothing is collectible
 */
export function collectibleBalance({
  remainingAmount = 0,
  paymentStatus = null,
  lifecycleStatus = null,
} = {}) {
  if (!isBalanceCollectible({ paymentStatus, lifecycleStatus })) return 0;
  const remaining = Number(remainingAmount ?? 0);
  if (!Number.isFinite(remaining) || remaining <= 0) return 0;
  return remaining;
}

/**
 * The balance still due on a workshop / formation reservation.
 *
 * `reservation.balanceDue` is the balance of the plan as booked and is not
 * rewritten when the balance is later collected (till, terminal, virement) —
 * only the Payment row moves. Reading it directly told staff "Solde : 1540 €"
 * on a formation whose payment was PAID in full. The Payment row wins whenever
 * there is one; the reservation's own figure is only the fallback.
 *
 * @param {{ status?: string|null, balanceDue?: number|string|null, payment?: { remainingAmount?: number|string|null, status?: string|null }|null }} reservation
 * @returns {number} never negative, 0 when nothing is collectible
 */
export function reservationBalanceDue(reservation) {
  if (!reservation) return 0;
  const { payment } = reservation;
  return collectibleBalance({
    remainingAmount: payment ? payment.remainingAmount : reservation.balanceDue,
    paymentStatus: payment?.status ?? null,
    lifecycleStatus: reservation.status ?? null,
  });
}
