"use server";

import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { workshopReservationReminderEmail } from "@/lib/email-templates";

/**
 * For the /api/cron job runner, not called from the UI.
 *
 * Fires once, 24h before the session, for CONFIRMED reservations only
 * (a PENDING_DEPOSIT reservation was never actually secured). Dedup is a
 * plain reminderSentAt timestamp on the reservation itself — one reminder
 * per booking is all this needs, unlike appointments' 24h+2h pair.
 */
const REMINDER_HOURS_BEFORE = 24;

export async function sendWorkshopReservationReminders() {
  const now = new Date();
  const cutoff = new Date(now.getTime() + REMINDER_HOURS_BEFORE * 60 * 60 * 1000);

  const reservations = await prisma.workshopReservation.findMany({
    where: {
      status: "CONFIRMED",
      reminderSentAt: null,
      session: { startDate: { gt: now, lte: cutoff } },
    },
    include: {
      customer: { select: { fullName: true, email: true } },
      session: { select: { startDate: true, workshop: { select: { title: true } } } },
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

    await prisma.workshopReservation.update({
      where: { id: reservation.id },
      data: { reminderSentAt: now },
    });

    sendEmail({
      to: reservation.customer.email,
      ...workshopReservationReminderEmail({
        customerName: reservation.customer.fullName,
        activityTitle: reservation.session.workshop.title,
        sessionDate,
      }),
    }).catch((err) => console.error("[sendWorkshopReservationReminders] email failed:", err));

    sentCount += 1;
  }

  return { success: true, sentCount };
}
