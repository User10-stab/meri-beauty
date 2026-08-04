"use server";

import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { formationReservationReminderEmail } from "@/lib/email-templates";

/**
 * For the /api/cron job runner, not called from the UI. Mirrors
 * actions/workshops/send-reminders.js exactly — kept as a separate function
 * since the two modules are deliberately independent (see FormationReservation).
 */
const REMINDER_HOURS_BEFORE = 24;

export async function sendFormationReservationReminders() {
  const now = new Date();
  const cutoff = new Date(now.getTime() + REMINDER_HOURS_BEFORE * 60 * 60 * 1000);

  const reservations = await prisma.formationReservation.findMany({
    where: {
      status: "CONFIRMED",
      reminderSentAt: null,
      session: { startDate: { gt: now, lte: cutoff } },
    },
    include: {
      customer: { select: { fullName: true, email: true } },
      session: { select: { startDate: true, formation: { select: { title: true } } } },
    },
  });

  let sentCount = 0;

  for (const reservation of reservations) {
    const sessionDate = reservation.session.startDate.toLocaleDateString("fr-FR", {
      weekday: "long",
      day: "2-digit",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

    await prisma.formationReservation.update({
      where: { id: reservation.id },
      data: { reminderSentAt: now },
    });

    sendEmail({
      to: reservation.customer.email,
      ...formationReservationReminderEmail({
        customerName: reservation.customer.fullName,
        formationTitle: reservation.session.formation.title,
        sessionDate,
      }),
    }).catch((err) => console.error("[sendFormationReservationReminders] email failed:", err));

    sentCount += 1;
  }

  return { success: true, sentCount };
}
