import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { waitingListNotificationEmail } from "@/lib/email-templates";

/**
 * Notify everyone on the waiting list that a spot is available.
 * Called when a reservation is cancelled or a seat frees up.
 * The spot goes to the first person who finalizes their reservation.
 * The link stays valid as long as the session remains bookable (no 2h window).
 *
 * Deliberately kept out of any "use server" module — every export from a
 * "use server" file is a public, unauthenticated POST endpoint, and this
 * mass-emails everyone on a session's waiting list on each call.
 */
export async function notifyAllInWaitingList(sessionId) {
  try {
    // Find all WAITING entries
    const waitingEntries = await prisma.waitingListEntry.findMany({
      where: {
        sessionId,
        status: "WAITING",
      },
      orderBy: { position: "asc" },
      include: {
        customer: true,
        session: {
          include: { workshop: true },
        },
      },
    });

    if (waitingEntries.length === 0) {
      return { success: true, notified: 0, message: "Personne en liste d'attente." };
    }

    await prisma.waitingListEntry.updateMany({
      where: {
        sessionId,
        status: "WAITING",
      },
      data: {
        status: "NOTIFIED",
        notifiedAt: new Date(),
      },
    });

    // Send notification email to everyone
    const session = waitingEntries[0].session;
    const sessionDate = new Date(session.startDate).toLocaleDateString("fr-FR", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Europe/Brussels",
    });

    for (const entry of waitingEntries) {
      const reservationUrl = `${process.env.NEXT_PUBLIC_APP_URL}/reservation-atelier?activity=${session.workshopId}&session=${sessionId}&priority=true&wl=${entry.id}`;
      const emailTemplate = waitingListNotificationEmail({
        customerName: entry.customer.fullName,
        activityTitle: session.workshop.title,
        sessionDate,
        reservationUrl,
      });

      sendEmail({ to: entry.customer.email, ...emailTemplate }).catch(() => {});
    }

    return {
      success: true,
      notified: waitingEntries.length,
    };
  } catch (error) {
    console.error("[notifyAllInWaitingList]", error?.message || error);
    return { success: false, message: "Erreur lors de la notification." };
  }
}
