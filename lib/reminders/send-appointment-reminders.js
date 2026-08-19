import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { appointmentReminderEmail } from "@/lib/email-templates";

/**
 * For the /api/cron job runner, not called from the UI. Deliberately kept
 * out of any "use server" module — every export from a "use server" file is
 * a public, unauthenticated POST endpoint, and this mass-emails every
 * customer with an upcoming appointment on each call.
 *
 * Customer reminders are EMAIL-ONLY (never dashboard notifications).
 *
 * Dedup: each window has its own reminder{24h,2h}SentAt marker on the
 * appointment (mirrors reservations' reminderSentAt). Without it, the
 * window query below matches the same appointment on every cron tick for
 * the entire 24h/2h lead-up, not just once.
 */
const WINDOWS = [
  { hoursBefore: 1, label: "Rappel 1 min ", sentAtField: "reminder24hSentAt" },
 //{ hoursBefore: 2, label: "Rappel 2h", sentAtField: "reminder2hSentAt" },
];
// const WINDOWS = [
//   { hoursBefore: 24, label: "Rappel 24h", sentAtField: "reminder24hSentAt" },
//   { hoursBefore: 2, label: "Rappel 2h", sentAtField: "reminder2hSentAt" },
// ];

export async function sendAppointmentReminders() {
  const now = new Date();
  let sentCount = 0;

  for (const window of WINDOWS) {
    const cutoff = new Date(now.getTime() + window.hoursBefore * 60 * 1000);

    const appointments = await prisma.appointment.findMany({
      where: {
        status: "CONFIRMED",
        isDeleted: false,
        startTime: { gt: now, lte: cutoff },
        [window.sentAtField]: null,
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
          hoursBefore: window.hoursBefore,
        }),
      }).catch((err) => console.error("[sendAppointmentReminders] email failed:", err));

      sentCount += 1;
    }
  }

  return { success: true, sentCount };
}
