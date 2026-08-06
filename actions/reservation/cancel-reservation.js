"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { stripe } from "@/lib/stripe";
import { issueCreditNote } from "@/lib/invoicing";
import { isWithinCancellationWindow, CANCELLATION_WINDOW_HOURS } from "@/lib/reservationRules";

const CANCELLABLE_STATUSES = ["PENDING", "CONFIRMED"];

/**
 * Allows an authenticated CUSTOMER to cancel one of their own reservations.
 *
 * Business rules enforced here (server-side — never trust the client):
 *  - User must be authenticated.
 *  - The appointment must belong to the authenticated user.
 *  - The appointment must not already be CANCELLED or COMPLETED.
 *  - The appointment must NOT start within the next 48 hours.
 *
 * If the appointment was already paid (online deposit or full payment), this
 * also issues a credit note and refunds via Stripe — mirrors the staff-side
 * rejectAppointment in actions/appointment/manage-appointment.js, which is
 * the reviewed reference implementation for this exact flow.
 *
 * @param {string} appointmentId
 * @returns {Promise<{ success: boolean, message?: string }>}
 */
export async function cancelReservation(appointmentId) {
  try {
    if (!appointmentId) {
      return { success: false, message: "Identifiant de réservation manquant." };
    }

    const session = await auth();
    if (!session?.user?.id) {
      return { success: false, message: "Authentification requise." };
    }

    const appointment = await prisma.appointment.findUnique({
      where: { id: appointmentId, isDeleted: false },
      include: { payment: { include: { invoice: true } } },
    });

    if (!appointment) {
      return { success: false, message: "Réservation introuvable." };
    }

    // Ownership check — customer can only cancel their own appointments
    if (appointment.userId !== session.user.id) {
      return { success: false, message: "Vous n'êtes pas autorisé à annuler cette réservation." };
    }

    // Terminal status check
    if (appointment.status === "CANCELLED") {
      return { success: false, message: "Cette réservation est déjà annulée." };
    }
    if (appointment.status === "COMPLETED") {
      return { success: false, message: "Les réservations terminées ne peuvent pas être annulées." };
    }

    // 48-hour window check — enforce server-side regardless of what the UI shows
    if (isWithinCancellationWindow(appointment.startTime)) {
      return {
        success: false,
        message: `Les réservations ne peuvent pas être annulées moins de ${CANCELLATION_WINDOW_HOURS} heures avant le rendez-vous.`,
      };
    }

    const payment = appointment.payment;
    const wasPaid = Boolean(payment) && ["PAID", "PARTIALLY_PAID"].includes(payment.status);

    const claimed = await prisma.$transaction(async (tx) => {
      // Atomic claim, gated on the appointment still being cancellable —
      // without this, a double-click or a race with the Stripe webhook
      // confirming payment at the same instant could both pass a plain
      // read-then-check, and the webhook could resurrect a cancellation as
      // CONFIRMED right after this thinks it succeeded.
      const claim = await tx.appointment.updateMany({
        where: { id: appointmentId, status: { in: CANCELLABLE_STATUSES } },
        data: { status: "CANCELLED" },
      });
      if (claim.count === 0) return false;

      if (wasPaid && payment.invoice) {
        await issueCreditNote(tx, {
          invoiceId: payment.invoice.id,
          reason: "Réservation annulée par le client",
          totalInclVat: Number(payment.paidAmount),
        });
      }

      await tx.notification.create({
        data: {
          userId: session.user.id,
          appointmentId: appointment.id,
          type: "APPOINTMENT_CANCELLED",
          title: "Réservation annulée",
          message: `Votre réservation du ${new Date(appointment.date).toLocaleDateString("fr-FR")} a été annulée.`,
          status: "PENDING",
        },
      });

      return true;
    });

    if (!claimed) {
      return { success: false, message: "Cette réservation est déjà annulée." };
    }

    // Payment.status / the REFUND ledger row are only written once Stripe
    // actually confirms the refund — writing them unconditionally beforehand
    // would tell the customer "refunded" even if the Stripe call below fails.
    let refundFailed = false;
    if (wasPaid && payment.transactionReference) {
      const alreadyRefunded = await prisma.transaction.findFirst({
        where: { paymentId: payment.id, transactionType: "REFUND" },
        select: { id: true },
      });

      if (!alreadyRefunded) {
        try {
          const stripeSession = await stripe.checkout.sessions.retrieve(payment.transactionReference);
          if (stripeSession.payment_intent) {
            await stripe.refunds.create({ payment_intent: stripeSession.payment_intent });
            await prisma.$transaction([
              prisma.payment.update({ where: { id: payment.id }, data: { status: "REFUNDED" } }),
              prisma.transaction.create({
                data: {
                  paymentId: payment.id,
                  amount: payment.paidAmount,
                  method: "ONLINE",
                  transactionType: "REFUND",
                  paidAt: new Date(),
                },
              }),
            ]);
          }
        } catch (err) {
          // The cancellation and credit note are already committed and stay
          // — surface the refund failure loudly so it can be retried/handled
          // manually, rather than silently telling the customer it's done.
          console.error("[cancelReservation] REFUND FAILED for appointment", appointmentId, err);
          refundFailed = true;
        }
      }
    }

    return {
      success: true,
      message: wasPaid
        ? refundFailed
          ? "Votre réservation a été annulée. Le remboursement est en cours de traitement par notre équipe — vous serez recontacté(e) si besoin."
          : "Votre réservation a été annulée. Le remboursement apparaîtra sur votre compte sous quelques jours."
        : "Votre réservation a été annulée.",
    };
  } catch (error) {
    console.error("[cancelReservation]", error);
    return { success: false, message: "Une erreur est survenue. Veuillez réessayer." };
  }
}
