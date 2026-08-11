import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { lowSeatsAnnouncementEmail } from "@/lib/email-templates";
import { checkWorkshopSessionAvailability } from "@/actions/workshops/create-workshop-reservation";
import { buildUnsubscribeUrl } from "@/lib/newsletter-consent";
import { getAppBaseUrl } from "@/lib/site-url";

/**
 * Broadcasts a "hurry, almost full" email to every newsletter-opted-in
 * customer when a session has 1-2 available seats left — same threshold as
 * the homepage low-seats banner (get-homepage-banner-data.js). Deliberately
 * kept out of any "use server" module — every export from a "use server"
 * file is a public, unauthenticated POST endpoint, and this mass-emails the
 * whole newsletter on each call. Its one legitimate caller is the Stripe
 * webhook, right after a reservation is confirmed.
 *
 * Must exclude available === 0 same as the banner does: this fires from the
 * payment webhook right after a reservation is confirmed, so booking the
 * literal last seat would otherwise send "plus que 0 place !" to the whole
 * newsletter — a real bug, not just a cosmetic mismatch with the banner.
 * Fires at most once per session (guarded by
 * WorkshopSession.lowSeatsNotifiedAt) so a string of bookings on an
 * already-low session doesn't re-blast the list.
 */
export async function sendLowSeatsBroadcast(sessionId) {
  try {
    const availability = await checkWorkshopSessionAvailability(sessionId);
    if (!availability.success || availability.data.available >= 3 || availability.data.available <= 0) {
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
      select: { id: true, fullName: true, email: true },
    });

    const sessionDate = new Date(session.startDate).toLocaleDateString("fr-FR", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

    const baseUrl = getAppBaseUrl();
    for (const subscriber of subscribers) {
      sendEmail({
        to: subscriber.email,
        ...lowSeatsAnnouncementEmail({
          customerName: subscriber.fullName,
          activityTitle: session.workshop.title,
          sessionDate,
          seatsLeft: availability.data.available,
          unsubscribeUrl: buildUnsubscribeUrl(baseUrl, subscriber.id),
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
