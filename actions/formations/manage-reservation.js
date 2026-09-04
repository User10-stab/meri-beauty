"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { formationCancellationEmail } from "@/lib/email-templates";
import { isAdminRole, STAFF_PERMISSIONS } from "@/lib/authorization";
import {
  ACTIVITY_RESERVATION_KINDS,
  authorizeActivityReservationOperation,
} from "@/lib/activity-reservation-access";
import { notifyAllInFormationWaitingList } from "@/lib/formations/notify-waiting-list";
import { issueCreditNote, issueInvoice, buildInvoiceCustomer, buildServiceInvoiceLines } from "@/lib/invoicing";
import { queueManualRefund } from "@/lib/refunds/queue-manual-refund";
import { settleReservation, markReservationNoShow, RESERVATION_KINDS } from "@/lib/reservations/settle-reservation";
import { hasInvoiceableVatIdentity } from "@/lib/tax-policy";
import { isBusinessRefundCustomer } from "@/lib/refunds/document-policy";

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
        customer: { include: { billingProfile: true } },
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

    // Converted 2026-09-02: this no longer refunds. An OWNER/ADMIN performs
    // the Stripe refund by hand; what happens here is that the credit note
    // is issued and the money owed is recorded as a RefundOperation, which
    // surfaces on /dashboard/operations with the exact amount and
    // payment_intent until it has actually been paid back.
    //
    // Dropping payment.transactionReference from the condition on purpose:
    // a formation settled in cash used to fall through refunding nothing
    // and issuing no credit note at all.
    let refundQueued = false;
    let queuedRefundAmount = 0;
    if (refundPayment && reservation.payment) {
      const payment = reservation.payment;
      const alreadyRefunded = payment.transactions
        .filter((transaction) => transaction.transactionType === "REFUND" && !transaction.isDeleted)
        .reduce((sum, transaction) => sum + Number(transaction.amount), 0);
      const remainingRefund = Math.max(0, Number(payment.paidAmount) - alreadyRefunded);

      if (remainingRefund > 0.01) {
        await prisma.$transaction(async (tx) => {
          let creditNoteId = null;
          if (payment.invoice) {
            const creditNote = await issueCreditNote(tx, {
              invoiceId: payment.invoice.id,
              reason: reason.trim(),
              totalInclVat: remainingRefund,
            });
            creditNoteId = creditNote.id;
          }

          const queued = await queueManualRefund(tx, {
            paymentId: payment.id,
            source: "FORMATION",
            trigger: "SALON_CANCELLATION",
            reason: reason.trim(),
            amount: remainingRefund,
            transactions: payment.transactions,
            creditNoteId,
            invoiceId: payment.invoice?.id ?? null,
            decidedByUserId: session.user.id,
            customerIsBusiness: isBusinessRefundCustomer(reservation.customer),
          });
          refundQueued = Boolean(queued);
          if (queued) queuedRefundAmount = remainingRefund;
        });
      }
    } else if (
      !refundPayment &&
      reservation.payment &&
      Number(reservation.payment.paidAmount) > 0.01 &&
      !reservation.payment.invoice
    ) {
      // Deposit kept, not refunded — this is now final, non-refundable
      // revenue, and Belgian law requires an invoice for it just as much as
      // for a normally-settled reservation (see settleReservation's own
      // issueInvoice call). Never invoiced at collection time (see
      // lib/reservations/settle-reservation.js's doc comment), so this is
      // the only point where that invoice gets issued for a forfeited
      // deposit.
      const payment = reservation.payment;
      await prisma.$transaction(async (tx) => {
        if (hasInvoiceableVatIdentity(reservation.customer)) {
          await issueInvoice(tx, {
            paymentId: payment.id,
            source: "FORMATION",
            totalInclVat: Number(payment.paidAmount),
            customer: buildInvoiceCustomer(reservation.customer),
            lines: buildServiceInvoiceLines({
              description: `Annulation — acompte non remboursable — ${reservation.session.formation.title}`,
              totalAmount: Number(payment.paidAmount),
            }),
          });
        }
        await tx.payment.update({ where: { id: payment.id }, data: { status: "PAID" } });
      });
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
            // Always false: this app does not move money, so it can never
            // announce a completed refund here. The customer is told one is
            // coming, and only the charge.refunded webhook (or a confirmed
            // hand-over) sends the "c'est fait" mail, from
            // notify-refund-complete.js.
            refunded: false,
            refundPending: refundQueued,
            refundAmount: refundQueued ? queuedRefundAmount : null,
            // An exceptional approval carries the admin's written reason
            // through reviewReservationCancellationRequest — the customer
            // who asked for the exception is the one person entitled to it.
            decisionNote: reason?.trim() || null,
          }),
        })
      )
      .catch((err) => console.error("[cancelFormationReservation] email failed:", err));

    revalidatePath("/dashboard/formations/reservations");
    revalidatePath("/dashboard/operations");
    return {
      success: true,
      message: refundPayment
        ? refundQueued
          ? "Réservation annulée. Le remboursement est à effectuer — voir « Remboursements dus » dans Opérations."
          : "Réservation annulée. Aucun montant restant à rembourser."
        : "Réservation annulée sans remboursement.",
      refundQueued,
    };
  } catch (error) {
    if (error.message === "REFUND_ALREADY_PENDING") {
      return { success: false, message: "Un remboursement est déjà en cours pour cette réservation — attendez sa résolution avant de réessayer." };
    }
    console.error("[cancelFormationReservation]", error);
    return { success: false, message: "Erreur lors de l'annulation." };
  }
}

/**
 * Closes out a formation reservation. Admins may close every reservation;
 * staff require the explicit settlement capability and an assignment to the
 * formation or the particular session.
 */
export async function completeFormationReservation(reservationId, { method, paymentConfirmed } = {}) {
  const session = await auth();
  if (!session?.user) return { success: false, message: "Non authentifié." };
  const authorization = await authorizeActivityReservationOperation({
    kind: ACTIVITY_RESERVATION_KINDS.FORMATION,
    reservationId,
    user: session.user,
    capability: STAFF_PERMISSIONS.ACTIVITY_SETTLEMENTS,
  });
  if (!authorization.success) return authorization;

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

/** Records a no-show. Never refunds — the deposit is kept by design. */
export async function markFormationReservationNoShow(reservationId) {
  const session = await auth();
  if (!session?.user) return { success: false, message: "Non authentifié." };
  const authorization = await authorizeActivityReservationOperation({
    kind: ACTIVITY_RESERVATION_KINDS.FORMATION,
    reservationId,
    user: session.user,
    capability: STAFF_PERMISSIONS.ACTIVITY_ATTENDANCE,
  });
  if (!authorization.success) return authorization;

  const result = await markReservationNoShow({
    kind: "FORMATION",
    reservationId,
    actorId: session.user.id,
  });

  if (result.success) revalidatePath(RESERVATION_KINDS.FORMATION.revalidatePath);
  return result;
}

