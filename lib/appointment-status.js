/**
 * Appointment states that still occupy the staff member's calendar.
 *
 * Keep this list centralized: ACCEPTED is a real reservation awaiting the
 * customer's payment choice, so treating it as free capacity would allow a
 * second customer to book the same staff member and time.
 */
export const ACTIVE_APPOINTMENT_STATUSES = Object.freeze([
  "PENDING",
  "ACCEPTED",
  "CONFIRMED",
]);

export const CUSTOMER_ACTIONABLE_APPOINTMENT_STATUSES = ACTIVE_APPOINTMENT_STATUSES;

/**
 * Resolve the appointment state after Stripe confirms an online payment.
 *
 * - An accepted manual request becomes confirmed.
 * - An automatic booking becomes confirmed.
 * - Any other manual state is preserved. This prevents a delayed webhook
 *   from moving a confirmed/completed appointment backwards to PENDING.
 */
export function resolveAppointmentStatusAfterPayment({
  currentStatus,
  confirmationMode,
}) {
  if (currentStatus === "ACCEPTED") return "CONFIRMED";
  if (String(confirmationMode ?? "MANUAL").toUpperCase() === "AUTOMATIC") {
    return "CONFIRMED";
  }
  return currentStatus;
}
