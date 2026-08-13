import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { appointmentReminderEmail } from "@/lib/email-templates";

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * CRON JOB : `sendAppointmentReminders`
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Sends reminder emails ("rappel") to customers for their upcoming salon
 * appointments (rendez-vous). This is triggered EITHER:
 *   1. Externally via HTTP   → GET /api/cron/appointments (app/api/cron/appointments/route.js)
 *   2. In-process scheduler  → interval in lib/background-jobs.js (every 5 min)
 *
 * Two reminder windows are sent per appointment:
 *   • "Rappel 24h" → 24 hours before the appointment
 *   • "Rappel 2h"  → 2 hours before the appointment
 *
 * Notes:
 *   • Customer reminders are EMAIL-ONLY (never dashboard notifications).
 *   • Only CONFIRMED, non-deleted appointments in the upcoming window are
 *     targeted — cancelled or past appointments are excluded.
 *   • Deduplication relies on the scheduling cadence + the narrow query window
 *     rather than a per-customer "reminderSentAt" marker. If stricter once-only
 *     sending is ever needed, a dedicated customer-email marker should be added
 *     instead of reusing Notification rows for customers.
 *
 * This file is deliberately kept OUT of any "use server" module — every export
 * of a "use server" file becomes a public, unauthenticated POST endpoint, and
 * this function mass-emails every eligible customer on each call, so it must
 * stay server-side trusted code.
 *
 * @returns {Promise<{ success: boolean, sentCount: number }>}
 *   - success   : always true unless an exception is thrown
 *   - sentCount : total number of reminder emails fired (both windows combined)
 * ─────────────────────────────────────────────────────────────────────────────
 */

// The two reminder windows, 24 hours before and 2 hours before the appointment.
// Each window runs a separate database query and sends its own batch of emails.
const WINDOWS = [
  { hoursBefore: 24, label: "Rappel 24h" },
  { hoursBefore: 2, label: "Rappel 2h" },
];

export async function sendAppointmentReminders() {
  // `now` is captured ONCE at the top so both windows query against the same
  // reference point — prevents a slow first window from shifting the second
  // window's cutoff and double-sending or skipping appointments.
  const now = new Date();
  let sentCount = 0;

  // Loop over each reminder window (24h and 2h) independently.
  for (const window of WINDOWS) {
    // Cutoff = now + hoursBefore. This defines the "upcoming window" for this
    // reminder: appointments whose startTime is between `now` (exclusive) and
    // `cutoff` (inclusive) are exactly the ones that are `hoursBefore` hours
    // away, so they get this window's reminder.
    const cutoff = new Date(now.getTime() + window.hoursBefore * 60 * 60 * 1000);

    // Query for all CONFIRMED, non-deleted appointments starting in this
    // window. Include the customer's identity (name + email for the mail) and
    // the staff/service details (for the "votre experte" / "votre service"
    // placeholders in the template).
    const appointments = await prisma.appointment.findMany({
      where: {
        status: "CONFIRMED", // Only booked & confirmed appointments get reminders
        isDeleted: false,     // Never remind for soft-deleted appointments
        startTime: { gt: now, lte: cutoff }, // Strictly in the upcoming window
      },
      include: {
        user: { select: { id: true, fullName: true, email: true } },
        staffService: {
          include: {
            service: true,
            staff: { include: { user: { select: { fullName: true } } } },
          },
        },
      },
    });

    // Send one reminder email per qualifying appointment in this window.
    for (const appt of appointments) {
      // Friendly fallbacks so the template never shows raw null/undefined even
      // if a relation is somehow missing.
      const staffName = appt.staffService.staff?.user?.fullName ?? "votre experte";
      const serviceName = appt.staffService.service?.name ?? "votre service";
      // Time-of-day formatted in French (e.g. "14:30"); date is passed as-is.
      const time = appt.startTime.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

      // Fire-and-forget email: the `.catch` swallows per-email delivery errors
      // so one failed SMTP send can't crash the whole cron run (which would
      // skip the remaining reminders in this window).
      sendEmail({
        to: appt.user.email,
        ...appointmentReminderEmail({
          customerName: appt.user.fullName,
          serviceName,
          staffName,
          date: appt.date,
          time,
          hoursBefore: window.hoursBefore, // Drives "dans 24h" vs "dans 2h" copy
        }),
      }).catch((err) => console.error("[sendAppointmentReminders] email failed:", err));

      // Count every email we *attempted* to send, even if delivery later fails.
      sentCount += 1;
    }
  }

  // Report back to the caller (the HTTP cron route or the in-process scheduler)
  // so it can log / return how many reminders were dispatched.
  return { success: true, sentCount };
}