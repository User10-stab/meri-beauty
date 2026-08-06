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
