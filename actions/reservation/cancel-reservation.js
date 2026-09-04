"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { issueCreditNote } from "@/lib/invoicing";
import { queueManualRefund } from "@/lib/refunds/queue-manual-refund";
import { isBusinessRefundCustomer } from "@/lib/refunds/document-policy";
import {
  isWithinCancellationWindow,
  requiresAdminApprovalToCancel,
  CANCELLATION_WINDOW_HOURS,
} from "@/lib/reservationRules";
import { sendEmail } from "@/lib/email";
import { staffReservationCancelledEmail } from "@/lib/email-templates";
import {
  createNotificationsBulk,
  buildAppointmentCancelledNotification,
  getAppointmentNotificationRecipients,
  getAppointmentEmailRecipients,
} from "@/lib/notifications";

const CANCELLABLE_STATUSES = ["PENDING", "ACCEPTED", "CONFIRMED"];

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
 * also issues a credit note and creates a durable manual-refund work item.
 * The team completes the Stripe refund from Operations; this action never
 * moves money itself.
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
      include: {
        payment: { include: { invoice: true, transactions: true } },
        user: { select: { fullName: true, isCompany: true, vatNumber: true } },
        staffService: {
          include: {
            service: { select: { name: true } },
            staff: { include: { user: { select: { fullName: true } } } },
          },
        },
      },
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

    const payment = appointment.payment;

    // Server-side enforcement, regardless of what the UI shows, of both
    // gates that take self-cancellation off the table: the 48h window, and
    // — 18 Aug 2026 — a still-PENDING request that already took a payment.
    // Under pay-first the customer pays before staff decide; without the
    // second gate they could pay, then cancel their own undecided request a
    // moment later and get an automatic refund, which is exactly what
    // paying up front was meant to prevent. See
    // requiresAdminApprovalToCancel's doc comment for the full reasoning —
    // a staff DECLINE of the same request is unaffected, that always
    // refunds in full via rejectAppointment.
    if (requiresAdminApprovalToCancel(appointment, payment)) {
      const withinWindow = isWithinCancellationWindow(appointment.startTime);
      return {
        success: false,
        message: withinWindow
          ? `Les réservations ne peuvent pas être annulées moins de ${CANCELLATION_WINDOW_HOURS} heures avant le rendez-vous.`
          : "Un paiement a déjà été effectué pour cette demande en attente de confirmation. Envoyez une demande exceptionnelle pour qu'un administrateur examine un remboursement.",
      };
    }

    const wasPaid = Boolean(payment) && ["PAID", "PARTIALLY_PAID"].includes(payment.status);

    // Cap against what's actually still outstanding — a prior partial refund
    // can already have refunded part of this payment. Summing (not just
    // checking existence of) prior REFUND transactions is what stops this
    // from either over-crediting past the invoice total or silently skipping
    // the remaining balance once any refund exists at all — mirrors
    // completeReturnRequest's exact pattern.
    const REFUND_EPSILON = 0.01;
    let remaining = 0;
    if (wasPaid) {
      const priorRefunds = await prisma.transaction.aggregate({
        where: { paymentId: payment.id, transactionType: "REFUND" },
        _sum: { amount: true },
      });
      const alreadyRefunded = Number(priorRefunds._sum.amount ?? 0);
      remaining = Number(payment.paidAmount) - alreadyRefunded;
    }

    const needsRefund = wasPaid && payment.transactionReference && remaining > REFUND_EPSILON;

    const claimed = await prisma.$transaction(async (tx) => {
      // Atomic claim, gated on the appointment still being cancellable —
      // without this, a double-click or a race with the Stripe webhook
      // confirming payment at the same instant could both pass a plain
      // read-then-check, and the webhook could resurrect a cancellation as
      // CONFIRMED right after this thinks it succeeded.
      const claim = await tx.appointment.updateMany({
        where: { id: appointmentId, status: { in: CANCELLABLE_STATUSES } },
        data: {
          status: "CANCELLED",
          cancelledAt: new Date(),
          cancelledByUserId: session.user.id,
          cancellationReason: "Annulation demandée par le client",
          cancellationSource: "CUSTOMER",
        },
      });
      if (claim.count === 0) return null;

      let creditNote = null;
      if (wasPaid && payment.invoice && remaining > REFUND_EPSILON) {
        creditNote = await issueCreditNote(tx, {
          invoiceId: payment.invoice.id,
          reason: "Réservation annulée par le client",
          totalInclVat: remaining,
        });
      }

      // The cancellation, document, and manual-refund operation commit
      // together. A retry cannot leave a second credit note without a
      // corresponding Operations work item.
      const queued = needsRefund
        ? await queueManualRefund(tx, {
            paymentId: payment.id,
            source: "APPOINTMENT",
            trigger: "CUSTOMER_SELF_CANCELLATION",
            reason: "Annulation demandée par le client",
            amount: remaining,
            transactions: payment.transactions,
            creditNoteId: creditNote?.id ?? null,
            invoiceId: payment.invoice?.id ?? null,
            decidedByUserId: session.user.id,
            customerIsBusiness: isBusinessRefundCustomer(appointment.user),
          })
        : null;

      return {
        claimed: true,
        creditNoteId: creditNote?.id ?? null,
        refundOperationId: queued?.operationId ?? null,
      };
    });

    if (!claimed?.claimed) {
      return { success: false, message: "Cette réservation est déjà annulée." };
    }

    // Notifications (outside transaction - business operation already committed)
    const serviceName = appointment.staffService?.service?.name;
    const customerName = appointment.user?.fullName;
    const staffUser = appointment.staffService?.staff?.user;
    const recipientUserIds = await getAppointmentNotificationRecipients(appointment.staffId);

    if (recipientUserIds.length > 0) {
      try {
        await createNotificationsBulk(
          recipientUserIds.map((uid) =>
            buildAppointmentCancelledNotification({
              userId: uid,
              appointmentId: appointment.id,
              date: appointment.date,
              startTime: appointment.startTime,
              serviceName,
              reason: "Annulé par le client",
              customerName,
            })
          )
        );
      } catch (err) {
        if (err?.message === "VALIDATION_ERROR") {
          console.error("[cancelReservation] notification validation error:", err.fieldErrors);
        } else {
          console.error("[cancelReservation] notifications failed:", err);
        }
      }
    }

    // Send email to assigned staff member and admin/owner users
    const emailRecipients = await getAppointmentEmailRecipients(appointment.staffId);
    for (const recipient of emailRecipients) {
      await sendEmail({
        to: recipient.email,
        ...staffReservationCancelledEmail({
          staffName: recipient.fullName,
          customerName: customerName,
          serviceName: serviceName,
          date: appointment.date,
          time: appointment.startTime ? appointment.startTime.toTimeString().slice(0, 5) : "",
          reason: "Annulé par le client",
        }),
      }).catch((err) => console.error("[cancelReservation] dashboard email failed:", err));
    }

    return {
      success: true,
      message: wasPaid
        ? needsRefund
          ? "Votre réservation a été annulée. Le remboursement est en cours de traitement par notre équipe — vous serez recontacté(e) si besoin."
          : "Votre réservation a été annulée."
        : "Votre réservation a été annulée.",
    };
  } catch (error) {
    console.error("[cancelReservation]", error);
    return { success: false, message: "Une erreur est survenue. Veuillez réessayer." };
  }
}
