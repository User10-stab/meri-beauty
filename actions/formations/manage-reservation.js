"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { formationCancellationEmail } from "@/lib/email-templates";
import { isAdminRole } from "@/lib/authorization";
import { notifyAllInFormationWaitingList } from "@/lib/formations/notify-waiting-list";

function formatSessionDate(date) {
  return new Date(date).toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Admin-only: cancels a formation reservation. The client's confirmed policy
 * is "no client-side cancellation or modification at all" — this exists
 * purely as an internal admin tool (duplicate bookings, data-entry mistakes,
 * a customer who called to cancel and must be handled manually), not a
 * feature exposed to customers. No refund path — formation deposits are
 * non-refundable with no self-service exception (unlike ateliers, where she
 * explicitly asked for one); she still handles true force-majeure cases by
 * being contacted directly rather than through the dashboard.
 *
 * A freed seat is what actually gives the formation waiting list something
 * to do — availability is computed live from non-cancelled reservations, so
 * cancelling here is what makes a seat visibly open up again.
 */
export async function cancelFormationReservation(reservationId, { reason } = {}) {
  try {
    const session = await auth();
    if (!session?.user) {
      return { success: false, message: "Non authentifié." };
    }
    if (!isAdminRole(session.user.role)) {
      return { success: false, message: "Non autorisé." };
    }

    const reservation = await prisma.formationReservation.findUnique({
      where: { id: reservationId },
      include: { session: { include: { formation: true } }, customer: true },
    });
    if (!reservation) {
      return { success: false, message: "Réservation introuvable." };
    }
    if (reservation.status === "CANCELLED") {
      return { success: false, message: "Cette réservation est déjà annulée." };
    }

    // Atomic claim gated on the reservation not already being cancelled —
    // without this, two concurrent cancels (double-click, or two admins)
    // both pass the plain read-then-check above and both fire the
    // waiting-list notification / email twice.
    const claim = await prisma.formationReservation.updateMany({
      where: { id: reservationId, status: { not: "CANCELLED" } },
      data: {
        status: "CANCELLED",
        cancelledAt: new Date(),
        cancelledByUserId: session.user.id,
        notes: reason ? `${reservation.notes ? `${reservation.notes}\n` : ""}Annulation : ${reason}` : reservation.notes,
      },
    });
    if (claim.count === 0) {
      return { success: false, message: "Cette réservation est déjà annulée." };
    }

    notifyAllInFormationWaitingList(reservation.sessionId).catch((err) =>
      console.error("[cancelFormationReservation] waiting-list notify failed:", err)
    );

    prisma.salon
      .findFirst({ select: { phone: true, email: true } })
      .then((salon) =>
        sendEmail({
          to: reservation.customer.email,
          ...formationCancellationEmail({
            customerName: reservation.customer.fullName,
            formationTitle: reservation.session.formation.title,
            sessionDate: formatSessionDate(reservation.session.startDate),
            salonPhone: salon?.phone,
            salonEmail: salon?.email,
          }),
        })
      )
      .catch((err) => console.error("[cancelFormationReservation] email failed:", err));

    revalidatePath("/dashboard/formations/reservations");
    return { success: true, message: "Réservation annulée." };
  } catch (error) {
    console.error("[cancelFormationReservation]", error);
    return { success: false, message: "Erreur lors de l'annulation." };
  }
}
