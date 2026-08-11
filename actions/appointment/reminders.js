"use server";

import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { appointmentReminderEmail } from "@/lib/email-templates";

/**
 * For the /api/cron job runner, not called from the UI.
 *
 * Customer reminders are EMAIL-ONLY (never dashboard notifications).
 *
 * This job currently relies on the reminder window query plus the scheduler
 * cadence; if reminder emails need strict once-only deduplication later, that
 * should be implemented with a dedicated customer-email marker rather than
 * reintroducing Notification rows for customers.
 */
const WINDOWS = [
  { hoursBefore: 24, label: "Rappel 24h" },
  { hoursBefore: 2, label: "Rappel 2h" },
];

export async function sendAppointmentReminders() {
  const now = new Date();
  let sentCount = 0;

  for (const window of WINDOWS) {
    const cutoff = new Date(now.getTime() + window.hoursBefore * 60 * 60 * 1000);

    const appointments = await prisma.appointment.findMany({
      where: {
        status: "CONFIRMED",
        isDeleted: false,
        startTime: { gt: now, lte: cutoff },

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
      const staffName = appt.staffService.staff?.user?.fullName ?? "votre experte";
      const serviceName = appt.staffService.service?.name ?? "votre service";
      const time = appt.startTime.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });


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
