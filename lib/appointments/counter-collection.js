/**
 * Does finishing this appointment involve taking money at the counter?
 *
 * Three shapes reach the "Terminer" button, and until now only the first two
 * were recognised:
 *
 *   PARTIALLY_PAID          a deposit was paid online, a balance is owed
 *   PENDING + ON_SITE       a Payment row exists, nothing collected yet
 *   no Payment row at all   booked "payer au salon", taken in MANUAL
 *                           confirmation mode, or created by staff
 *
 * The third is the common one — `shouldCreatePaymentRecord`
 * (lib/reservation-payment.js) is only true when money is taken online at
 * booking, so every other route produces an appointment with no Payment row.
 * Completing one of those wrote nothing but a status change: no transaction,
 * no cash-book line, no invoice, and so no row in Opérations. The service
 * happened and the revenue was recorded nowhere.
 *
 * Kept in one place because two screens ask the question — the appointments
 * list and the calendar drawer — and they disagreed: the drawer only ever
 * recognised PARTIALLY_PAID, so even a PENDING/ON_SITE balance could not be
 * settled from the calendar. `completeAppointment` applies the same rule
 * server-side and is the authority; these helpers only decide whether to open
 * the dialog, and a screen that gets it wrong now produces a refusal rather
 * than a silent non-collection.
 *
 * The row shapes differ by one field name: the list serialises the service
 * price as `servicePrice`, the calendar as `price`. Both are read.
 */

function priceOf(row) {
  return Number(row?.servicePrice ?? row?.price ?? 0);
}

/** @param {{ paymentStatus?: string|null, paymentType?: string|null, servicePrice?: number, price?: number }} row */
export function appointmentCollectsAtCounter(row) {
  if (!row) return false;
  if (row.paymentStatus === "PARTIALLY_PAID") return true;
  if (row.paymentStatus === "PENDING" && row.paymentType === "ON_SITE") return true;
  // A zero-priced service collects nothing and still completes in one click,
  // which is why this is a price test and not merely a null-payment test.
  if (!row.paymentStatus) return priceOf(row) > 0;
  return false;
}

/** What the dialog should say is owed. */
export function appointmentAmountDueAtCounter(row) {
  if (!row) return 0;
  if (!row.paymentStatus) return priceOf(row);
  return Math.max(0, Number(row.totalAmount ?? 0) - Number(row.paidAmount ?? 0));
}
