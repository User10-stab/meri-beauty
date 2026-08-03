"use server";

import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { lowSeatsAnnouncementEmail } from "@/lib/email-templates";
import { checkWorkshopSessionAvailability } from "@/actions/workshops/create-workshop-reservation";

/**
 * Broadcasts a "hurry, almost full" email to every newsletter-opted-in
 * customer when a session drops below 2 available seats. Fires at most
 * once per session (guarded by WorkshopSession.lowSeatsNotifiedAt) so a
 * string of bookings on an already-low session doesn't re-blast the list.
 */
export async function sendLowSeatsBroadcast(sessionId) {
  try {
    const availability = await checkWorkshopSessionAvailability(sessionId);
    if (!availability.success || availability.data.available >= 2 || availability.data.available < 0) {
      return { success: true, sent: 0 };
    }

    const session = await prisma.workshopSession.findUnique({
      where: { id: sessionId },
      include: { workshop: true },
    });
    if (!session || session.lowSeatsNotifiedAt) {
      return { success: true, sent: 0 };
    }

    const subscribers = await prisma.user.findMany({
      where: { newsletterSubscribed: true, isDeleted: false, role: "CUSTOMER" },
      select: { fullName: true, email: true },
    });

    const sessionDate = new Date(session.startDate).toLocaleDateString("fr-FR", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

    for (const subscriber of subscribers) {
      sendEmail({
        to: subscriber.email,
        ...lowSeatsAnnouncementEmail({
          customerName: subscriber.fullName,
          activityTitle: session.workshop.title,
          sessionDate,
          seatsLeft: availability.data.available,
        }),
      }).catch((err) => console.error("[sendLowSeatsBroadcast] email failed:", err));
    }

    await prisma.workshopSession.update({
      where: { id: sessionId },
      data: { lowSeatsNotifiedAt: new Date() },
    });

    return { success: true, sent: subscribers.length };
  } catch (error) {
    console.error("[sendLowSeatsBroadcast]", error?.message || error);
    return { success: false, sent: 0 };
  }
}
