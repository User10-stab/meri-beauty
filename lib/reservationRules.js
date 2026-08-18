/**
 * Shared business rules for reservation modifications and cancellations.
 *
 * Single source of truth — import this wherever the 48-hour window
 * needs to be checked (server actions, client components, API routes).
 */

/** Number of hours before a reservation starts within which
 *  the customer can no longer modify or cancel it. */
export const CANCELLATION_WINDOW_HOURS = 48;

/**
 * Returns true if the appointment starts within the cancellation window,
 * meaning the customer can NO LONGER modify or cancel it.
 *
 * Works in both server and client environments (pure Date math, no Prisma).
 *
 * @param {Date | string} appointmentStartTime  - startTime of the appointment
 * @returns {boolean}
 */
export function isWithinCancellationWindow(appointmentStartTime) {
  if (!appointmentStartTime) return true; // safe default — block action
  const start = new Date(appointmentStartTime);
  const now = new Date();
  const diffMs = start.getTime() - now.getTime();
  const diffHours = diffMs / (1000 * 60 * 60);
  return diffHours < CANCELLATION_WINDOW_HOURS;
}

/** Payment states meaning money has actually been taken. */
const PAID_PAYMENT_STATUSES = ["PAID", "PARTIALLY_PAID"];

/**
 * Returns true if a customer cancelling (or rescheduling) this appointment
 * themselves cannot self-serve — the action must instead go through the
 * admin-reviewed exceptional-cancellation request.
 *
 * Two independent reasons trigger this:
 *  - the appointment starts within the 48h cancellation window (the
 *    original rule), or
 *  - the appointment is still PENDING (staff have not yet accepted the
 *    request) and a payment was already taken. Under pay-first, the
 *    customer pays before staff decide whether to accept — without this
 *    rule they could pay, then cancel their own still-undecided request an
 *    instant later and receive an automatic refund, which defeats the
 *    point of collecting payment up front (18 Aug 2026 salon decision).
 *
 * A staff DECLINE of the same PENDING request is a different action
 * (rejectAppointment) and is unaffected by this: that path always refunds a
 * PENDING request in full, since the salon — not the customer — is the one
 * backing out.
 *
 * Works in both server and client environments (pure logic, no Prisma).
 *
 * @param {{ status: string, startTime: Date | string }} appointment
 * @param {{ status: string } | null} [payment]
 * @returns {boolean}
 */
export function requiresAdminApprovalToCancel(appointment, payment) {
  if (isWithinCancellationWindow(appointment.startTime)) return true;
  const wasPaid = Boolean(payment) && PAID_PAYMENT_STATUSES.includes(payment.status);
  return appointment.status === "PENDING" && wasPaid;
}

/**
 * Returns the number of hours remaining until the cancellation window closes.
 * Useful for displaying a human-readable message to the customer.
 *
 * @param {Date | string} appointmentStartTime
 * @returns {number}  hours remaining (can be negative if window already passed)
 */
export function hoursUntilWindowCloses(appointmentStartTime) {
  if (!appointmentStartTime) return 0;
  const start = new Date(appointmentStartTime);
  const now = new Date();
  const diffMs = start.getTime() - now.getTime();
  return diffMs / (1000 * 60 * 60);
}
