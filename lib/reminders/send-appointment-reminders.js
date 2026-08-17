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
 * Dedup: each window has its own reminder{24h,2h}SentAt marker on the
 * appointment (mirrors reservations' reminderSentAt). Without it, the
 * window query below matches the same appointment on every cron tick for
 * the entire 24h/2h lead-up, not just once.
 */

// The two reminder windows, 24 hours before and 2 hours before the appointment.
// Each window runs a separate database query and sends its own batch of emails.
const WINDOWS = [
  { hoursBefore: 24, label: "Rappel 24h", sentAtField: "reminder24hSentAt" },
  { hoursBefore: 2, label: "Rappel 2h", sentAtField: "reminder2hSentAt" },
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
      // Atomic claim, gated on the marker still being null — without this,
      // the in-process interval (lib/background-jobs.js) and an external
      // HTTP-triggered cron hit (app/api/cron/appointments) could both read
      // this appointment as unsent in the findMany above and both send,
      // since a plain update() here has no such guard. The advisory lock in
      // the HTTP route only protects against that route overlapping itself,
      // not against the separate in-process interval running at the same
      // moment.
      const claim = await prisma.appointment.updateMany({
        where: { id: appt.id, [window.sentAtField]: null },
        data: { [window.sentAtField]: now },
      });
      if (claim.count === 0) continue;

      const staffName = appt.staffService.staff?.user?.fullName ?? "votre experte";
      const serviceName = appt.staffService.service?.name ?? "votre service";
      const time = appt.startTime.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Brussels" });

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