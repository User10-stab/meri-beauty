"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { stripe } from "@/lib/stripe";
import { sendEmail } from "@/lib/email";
import { workshopCancellationEmail } from "@/lib/email-templates";
import { isAdminRole } from "@/lib/authorization";
import { notifyAllInWaitingList } from "@/actions/workshops/waiting-list";
import { checkWorkshopSessionAvailability } from "@/actions/workshops/create-workshop-reservation";

const CANCELLATION_CUTOFF_HOURS = 48;
const SESSION_CHANGE_FEE_RATE = 0.1; // 10% of the reservation's total price

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
 * Admin-only: cancels a reservation on a customer's behalf. Deposits are
 * never refunded (see req: "no refund once paid the deposit"), and a
 * booking can't be cancelled within 48h of its session — both enforced
 * here since there's no customer self-service cancel flow in this app.
 */
export async function cancelWorkshopReservation(reservationId, { reason } = {}) {
  try {
    const session = await auth();
    if (!session?.user) {
      return { success: false, message: "Non authentifié." };
    }
    if (!isAdminRole(session.user.role)) {
      // Deletion = client-facing cancellation, kept admin-only to avoid disputes.
      return { success: false, message: "Non autorisé." };
    }

    const reservation = await prisma.workshopReservation.findUnique({
      where: { id: reservationId },
      include: { session: { include: { workshop: true } }, customer: true },
    });
    if (!reservation) {
      return { success: false, message: "Réservation introuvable." };
    }
    if (reservation.status === "CANCELLED") {
      return { success: false, message: "Cette réservation est déjà annulée." };
    }

    // Cutoff runs the opposite direction from a withdrawal window: it blocks
    // once too LITTLE time remains before a FUTURE session, not once too
    // much time has passed since a past one.
    const cutoff = new Date(reservation.session.startDate.getTime() - CANCELLATION_CUTOFF_HOURS * 3600 * 1000);
    if (new Date() > cutoff) {
      return {
        success: false,
        message: "Impossible d'annuler une réservation moins de 48h avant l'événement.",
      };
    }

    await prisma.workshopReservation.update({
      where: { id: reservationId },
      data: {
        status: "CANCELLED",
        cancelledAt: new Date(),
        cancelledByUserId: session.user.id,
        notes: reason ? `${reservation.notes ? `${reservation.notes}\n` : ""}Annulation : ${reason}` : reservation.notes,
      },
    });

    // Never stripe.refunds.create() here — deposits are non-refundable once
    // paid, unlike actions/boutique/orders.js#cancelOrder which does refund.

    notifyAllInWaitingList(reservation.sessionId).catch((err) =>
      console.error("[cancelWorkshopReservation] waiting-list notify failed:", err)
    );

    sendEmail({
      to: reservation.customer.email,
      ...workshopCancellationEmail({
        customerName: reservation.customer.fullName,
        activityTitle: reservation.session.workshop.title,
        sessionDate: formatSessionDate(reservation.session.startDate),
      }),
    }).catch((err) => console.error("[cancelWorkshopReservation] email failed:", err));

    revalidatePath("/dashboard/workshops/reservations");
    return { success: true, message: "Réservation annulée." };
  } catch (error) {
    console.error("[cancelWorkshopReservation]", error);
    return { success: false, message: "Erreur lors de l'annulation." };
  }
}

/**
 * Admin-only: moves a confirmed reservation to a different session of the
 * SAME activity, charging a 10% fee via a Stripe Checkout link. The move
 * only takes effect once the fee is paid — see the "session_change_fee"
 * branch in app/api/webhooks/stripe/route.js.
 */
export async function changeReservationSession(reservationId, newSessionId) {
  try {
    const session = await auth();
    if (!session?.user || !isAdminRole(session.user.role)) {
      return { success: false, message: "Non autorisé." };
    }

    const reservation = await prisma.workshopReservation.findUnique({
      where: { id: reservationId },
      include: { session: { include: { workshop: true } }, customer: true },
    });
    if (!reservation) {
      return { success: false, message: "Réservation introuvable." };
    }
    if (reservation.status !== "CONFIRMED") {
      return { success: false, message: "Seule une réservation confirmée peut être modifiée." };
    }
    if (newSessionId === reservation.sessionId) {
      return { success: false, message: "Cette réservation est déjà sur cette séance." };
    }

    const newSession = await prisma.workshopSession.findUnique({
      where: { id: newSessionId },
      include: { workshop: true },
    });
    if (!newSession) {
      return { success: false, message: "Séance cible introuvable." };
    }
    // Same-activity only — "changing your place" means a different date of
    // the same atelier, not switching to a different workshop entirely.
    if (newSession.workshopId !== reservation.session.workshopId) {
      return { success: false, message: "Le changement de séance n'est possible qu'au sein du même atelier." };
    }

    const availability = await checkWorkshopSessionAvailability(newSessionId);
    if (!availability.success || availability.data.available < reservation.seatsCount) {
      return { success: false, message: "La séance cible n'a pas assez de places disponibles." };
    }

    const changeFeeAmount = Number(reservation.totalPrice) * SESSION_CHANGE_FEE_RATE;

    const stripeSession = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "eur",
            product_data: {
              name: `Frais de modification - ${reservation.session.workshop.title}`,
              description: `Changement de séance (${new Date(newSession.startDate).toLocaleDateString("fr-FR")})`,
            },
            unit_amount: Math.round(changeFeeAmount * 100),
          },
          quantity: 1,
        },
      ],
      mode: "payment",
      success_url: `${process.env.NEXT_PUBLIC_APP_URL}/reservation-atelier/succes?reservation_id=${reservation.id}`,
      cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard/workshops/reservations`,
      customer_email: reservation.customer.email,
      metadata: {
        kind: "workshop",
        workshopAction: "session_change_fee",
        reservationId: reservation.id,
        newSessionId,
        changeFeeAmount: String(changeFeeAmount),
      },
      payment_intent_data: {
        metadata: {
          kind: "workshop",
          workshopAction: "session_change_fee",
          reservationId: reservation.id,
        },
      },
    });

    return {
      success: true,
      message: "Lien de paiement généré. Envoyez-le au client pour finaliser le changement.",
      paymentUrl: stripeSession.url,
      changeFeeAmount,
    };
  } catch (error) {
    console.error("[changeReservationSession]", error);
    return { success: false, message: "Erreur lors de la modification de la séance." };
  }
}
