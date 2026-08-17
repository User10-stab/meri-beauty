"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { formationCancellationEmail } from "@/lib/email-templates";
import { isAdminRole } from "@/lib/authorization";
import { notifyAllInFormationWaitingList } from "@/lib/formations/notify-waiting-list";
import { stripe } from "@/lib/stripe";
import { issueCreditNote } from "@/lib/invoicing";
import { buildRefundIdempotencyKey, pinPendingRefund, markRefundFailed, clearPendingRefund } from "@/lib/payments/pin-pending-refund";
import { settleReservation, markReservationNoShow, RESERVATION_KINDS } from "@/lib/reservations/settle-reservation";

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
 * Admin-only: cancels a formation reservation. The client's confirmed policy
 * is "no client-side cancellation or modification at all" — this exists
 * purely as an internal admin tool (duplicate bookings, data-entry mistakes,
 * a customer who called to cancel and must be handled manually), not a
 * feature exposed to customers. Deposits are non-refundable by default;
 * `refundPayment` is the same admin-discretion exception path as ateliers
 * (grave/force-majeure cases), never automatic — `reason` is required
 * whenever it's used, since it's what justifies the exception in the
 * reservation's own record.
 *
 * A freed seat is what actually gives the formation waiting list something
 * to do — availability is computed live from non-cancelled reservations, so
 * cancelling here is what makes a seat visibly open up again.
 */
export async function cancelFormationReservation(reservationId, { reason, refundPayment = false } = {}) {
  try {
    const session = await auth();
    if (!session?.user) {
      return { success: false, message: "Non authentifié." };
    }
    if (!isAdminRole(session.user.role)) {
      return { success: false, message: "Non autorisé." };
    }
    if (refundPayment && !reason?.trim()) {
      return { success: false, message: "Un motif est requis pour autoriser un remboursement exceptionnel." };
    }

    const reservation = await prisma.formationReservation.findUnique({
      where: { id: reservationId },
      include: {
        session: { include: { formation: true } },
        customer: true,
        payment: { include: { invoice: true, transactions: true } },
      },
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
        notes: reason
          ? `${reservation.notes ? `${reservation.notes}\n` : ""}${refundPayment ? "Annulation avec remboursement exceptionnel" : "Annulation"} : ${reason}`
          : reservation.notes,
      },
    });
    if (claim.count === 0) {
      return { success: false, message: "Cette réservation est déjà annulée." };
    }

    let refundFailed = false;
    if (refundPayment && reservation.payment?.transactionReference) {
      const payment = reservation.payment;
      const alreadyRefunded = payment.transactions
        .filter((transaction) => transaction.transactionType === "REFUND")
        .reduce((sum, transaction) => sum + Number(transaction.amount), 0);
      const remainingRefund = Math.max(0, Number(payment.paidAmount) - alreadyRefunded);

      if (remainingRefund > 0.01) {
        // Pinned in the same transaction as the credit note — see
        // lib/payments/pin-pending-refund.js's doc comment for why this has
        // to happen before the Stripe call below, not just in its catch.
        const refundIdempotencyKey = buildRefundIdempotencyKey("formation-cancel", payment.id);
        await prisma.$transaction(async (tx) => {
          await pinPendingRefund(tx, payment.id, remainingRefund, refundIdempotencyKey);
          if (payment.invoice) {
            await issueCreditNote(tx, {
              invoiceId: payment.invoice.id,
              reason: reason.trim(),
              totalInclVat: remainingRefund,
            });
          }
        });

        try {
          const checkoutSession = await stripe.checkout.sessions.retrieve(payment.transactionReference);
          if (!checkoutSession.payment_intent) throw new Error("Payment Intent Stripe introuvable.");
          const stripePaymentIntentId =
            typeof checkoutSession.payment_intent === "string"
              ? checkoutSession.payment_intent
              : checkoutSession.payment_intent.id;
          await stripe.refunds.create(
            {
              payment_intent: stripePaymentIntentId,
              amount: Math.round(remainingRefund * 100),
              metadata: { kind: "formation_admin_exception", reservationId, adminUserId: session.user.id },
            },
            { idempotencyKey: refundIdempotencyKey }
          );
          await prisma.$transaction([
            clearPendingRefund(prisma, payment.id, "REFUNDED"),
            prisma.transaction.updateMany({
              where: {
                paymentId: payment.id,
                transactionType: { in: ["DEPOSIT", "FINAL_PAYMENT"] },
                stripePaymentIntentId: null,
              },
              data: { stripePaymentIntentId },
            }),
            prisma.transaction.create({
              data: {
                paymentId: payment.id,
                amount: remainingRefund,
                method: "ONLINE",
                transactionType: "REFUND",
                paidAt: new Date(),
                stripeCheckoutSessionId: payment.transactionReference,
                stripePaymentIntentId,
              },
            }),
          ]);
        } catch (error) {
          // pendingRefundAmount/idempotencyKey are left set (not cleared) so
          // the cron retry job (lib/payments/retry-failed-refunds.js) can
          // pick this up.
          refundFailed = true;
          await markRefundFailed(prisma, payment.id, error);
        }
      }
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
    return {
      success: true,
      message: refundPayment
        ? refundFailed
          ? "Réservation annulée, mais le remboursement Stripe a échoué et doit être traité par l'administrateur."
          : "Réservation annulée et paiement remboursé à titre exceptionnel."
        : "Réservation annulée sans remboursement.",
      refundFailed,
    };
  } catch (error) {
    console.error("[cancelFormationReservation]", error);
    return { success: false, message: "Erreur lors de l'annulation." };
  }
}

/**
 * Admin-only: closes out a formation reservation, collecting the 50% on-site
 * balance and issuing the final invoice. Before this existed there was no
 * way to record that money at all — see lib/reservations/settle-reservation.js.
 */
export async function completeFormationReservation(reservationId, { method, paymentConfirmed } = {}) {
  const session = await auth();
  if (!session?.user) return { success: false, message: "Non authentifié." };
  if (!isAdminRole(session.user.role)) return { success: false, message: "Non autorisé." };

  const result = await settleReservation({
    kind: "FORMATION",
    reservationId,
    method,
    paymentConfirmed,
    actorId: session.user.id,
  });

  if (result.success) revalidatePath(RESERVATION_KINDS.FORMATION.revalidatePath);
  return result;
}

/** Admin-only: records a no-show. Never refunds — the deposit is kept by design. */
export async function markFormationReservationNoShow(reservationId) {
  const session = await auth();
  if (!session?.user) return { success: false, message: "Non authentifié." };
  if (!isAdminRole(session.user.role)) return { success: false, message: "Non autorisé." };

  const result = await markReservationNoShow({
    kind: "FORMATION",
    reservationId,
    actorId: session.user.id,
  });

  if (result.success) revalidatePath(RESERVATION_KINDS.FORMATION.revalidatePath);
  return result;
}
