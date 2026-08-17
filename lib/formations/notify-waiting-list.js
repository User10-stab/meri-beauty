import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { formationWaitingListNotificationEmail } from "@/lib/email-templates";

function formatSessionDate(date) {
  return new Date(date).toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Brussels",
  });
}

/**
 * Notify everyone on the waiting list that a spot is available — same
 * broadcast-to-all/first-paid-wins model as ateliers
 * (lib/workshops/notify-waiting-list.js), including the same fix: NOTIFIED
 * entries are re-queried alongside WAITING ones, since there's no expiry
 * window and a previously-notified person who hasn't booked (or given up)
 * yet must keep hearing about every later opening too — otherwise the list
 * goes deaf after the first notification round.
 *
 * Deliberately kept out of any "use server" module — every export from a
 * "use server" file is a public, unauthenticated POST endpoint, and this
 * mass-emails everyone on a session's waiting list on each call.
 */
export async function notifyAllInFormationWaitingList(sessionId) {
  try {
    const waitingEntries = await prisma.waitingListEntry.findMany({
      where: { formationSessionId: sessionId, status: { in: ["WAITING", "NOTIFIED"] } },
      orderBy: { position: "asc" },
      include: { customer: true, formationSession: { include: { formation: true } } },
    });

    if (waitingEntries.length === 0) {
      return { success: true, notified: 0, message: "Personne en liste d'attente." };
    }

    await prisma.waitingListEntry.updateMany({
      where: { formationSessionId: sessionId, status: { in: ["WAITING", "NOTIFIED"] } },
      data: { status: "NOTIFIED", notifiedAt: new Date() },
    });

    const session = waitingEntries[0].formationSession;
    const sessionDate = formatSessionDate(session.startDate);

    for (const entry of waitingEntries) {
      const reservationUrl = `${process.env.NEXT_PUBLIC_APP_URL}/reservation-formation?formation=${session.formationId}&session=${sessionId}&priority=true&wl=${entry.id}`;
      sendEmail({
        to: entry.customer.email,
        ...formationWaitingListNotificationEmail({
          customerName: entry.customer.fullName,
          formationTitle: session.formation.title,
          sessionDate,
          reservationUrl,
        }),
      }).catch(() => {});
    }

    return { success: true, notified: waitingEntries.length };
  } catch (error) {
    console.error("[notifyAllInFormationWaitingList]", error?.message || error);
    return { success: false, message: "Erreur lors de la notification." };
  }
}
