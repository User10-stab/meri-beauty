"use server";

import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { formationLowSeatsAnnouncementEmail } from "@/lib/email-templates";
import { checkFormationSessionAvailability } from "@/actions/formations/create-formation-reservation";

/**
 * Formation equivalent of actions/workshops/notify-low-seats.js — same
 * threshold (1-2 seats left, matching the homepage banner exactly —
 * available === 0 must be excluded too, or booking the last seat sends
 * "plus que 0 place !" to the newsletter) and same audience
 * (newsletter-opted-in customers), per her explicit instruction that
 * formation emails go out to everyone on the newsletter, matching how the
 * atelier broadcast already works. PRIVATE formations are always capacity 1,
 * so a "hurry" broadcast doesn't make sense there — callers only ever invoke
 * this for PUBLIC/GROUP sessions (see the webhook call site).
 */
export async function sendFormationLowSeatsBroadcast(sessionId) {
  try {
    const availability = await checkFormationSessionAvailability(sessionId);
    if (!availability.success || availability.data.available >= 3 || availability.data.available <= 0) {
      return { success: true, sent: 0 };
    }

    const session = await prisma.formationSession.findUnique({
      where: { id: sessionId },
      include: { formation: true },
    });
    if (!session || session.lowSeatsNotifiedAt || session.formation.type !== "PUBLIC") {
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
        ...formationLowSeatsAnnouncementEmail({
          customerName: subscriber.fullName,
          formationTitle: session.formation.title,
          sessionDate,
          seatsLeft: availability.data.available,
        }),
      }).catch((err) => console.error("[sendFormationLowSeatsBroadcast] email failed:", err));
    }

    await prisma.formationSession.update({
      where: { id: sessionId },
      data: { lowSeatsNotifiedAt: new Date() },
    });

    return { success: true, sent: subscribers.length };
  } catch (error) {
    console.error("[sendFormationLowSeatsBroadcast]", error?.message || error);
    return { success: false, sent: 0 };
  }
}
