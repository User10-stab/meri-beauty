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
import { issueCreditNote, issueInvoice, supersedeInvoice, buildInvoiceCustomer, buildServiceInvoiceLines } from "@/lib/invoicing";
import { queueManualRefund } from "@/lib/refunds/queue-manual-refund";
import { settleReservation, markReservationNoShow, RESERVATION_KINDS } from "@/lib/reservations/settle-reservation";
import { sendTicketByEmail } from "@/actions/payments/send-ticket-email";
import { changeReservationSeatsFree } from "@/lib/reservations/change-reservation-seats";
import { hasInvoiceableVatIdentity } from "@/lib/tax-policy";
import { isBusinessRefundCustomer } from "@/lib/refunds/document-policy";
import { AUDIT_ACTIONS, writeAuditLog } from "@/lib/audit-log";
import { formationSessionChangeEmail } from "@/lib/email-templates";
import { OCCUPANCY_KINDS, liveSeatFilter, sessionOccupancy } from "@/lib/reservations/session-occupancy";

// The transfer is a free admin correction — see changeFormationReservationSession.
const TRANSFER_PRICE_DECISIONS = {
  APPLY_TARGET_PRICE: "APPLY_TARGET_PRICE",
  KEEP_CURRENT_PRICE: "KEEP_CURRENT_PRICE",
};

function money(value) {
  return Number(Number(value ?? 0).toFixed(2));
}

function transferErrorMessage(code) {
  const messages = {
    INVALID_TRANSFER_INPUT: "La séance cible et un motif sont obligatoires.",
    RESERVATION_NOT_FOUND: "Réservation introuvable.",
    RESERVATION_NOT_CONFIRMED: "Seule une réservation confirmée peut être transférée.",
    RESERVATION_ALREADY_CHECKED_IN: "Cette réservation a déjà été pointée et ne peut plus être transférée.",
    SAME_SESSION: "Cette réservation est déjà sur cette séance.",
    TARGET_SESSION_NOT_AVAILABLE: "La séance cible n'est plus planifiée ou a déjà commencé.",
    TARGET_SESSION_FULL: "La séance cible n'a pas assez de places disponibles.",
    PAYMENT_NOT_FOUND: "Aucun paiement fiable n'est lié à cette réservation.",
    PAYMENT_UNDER_REFUND: "Un remboursement est déjà en cours ou enregistré pour ce paiement.",
    LEGAL_DOCUMENT_EXISTS: "Cette réservation a déjà été corrigée par une note de crédit. Traitez-la manuellement avant de transférer la réservation.",
    PRICE_DECISION_REQUIRED: "Choisissez si la différence de prix doit être ajoutée au solde ou offerte au client.",
    INVALID_PRICE_DECISION: "La décision de prix sélectionnée n'est pas valable.",
    OVERPAYMENT_REQUIRES_MANUAL_HANDLING: "Le montant déjà payé dépasse le nouveau prix. Traitez d'abord manuellement le trop-perçu avant le transfert.",
    INVOICE_REPLACEMENT_VAT_EXPIRED: "La validation TVA de ce client a expiré depuis l'émission de la facture initiale — impossible de réémettre une facture. Faites revalider le numéro TVA sur sa fiche, puis réessayez.",
    SELLER_LEGAL_DATA_INCOMPLETE: "Identité légale du salon incomplète — complétez Réglages > Salon avant de transférer une réservation facturée.",
  };
  return messages[code] ?? "Erreur lors du transfert de la réservation.";
}

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

    // Converted 2026-09-02: this no longer refunds. An OWNER/ADMIN performs
    // the Stripe refund by hand; what happens here is that the credit note
    // is issued and the money owed is recorded as a RefundOperation, which
    // surfaces on /dashboard/operations with the exact amount and
    // payment_intent until it has actually been paid back.
    //
    // Dropping payment.transactionReference from the condition on purpose:
    // a formation settled in cash used to fall through refunding nothing
    // and issuing no credit note at all.
    const cancellation = await prisma.$transaction(async (tx) => {
      // Reservation state, invoice/credit note, and refund worklist must be
      // one unit of work. If a financial write fails, the place is not
      // released and the booking remains exactly as it was.
      // Reload the payment under a row lock. The reservation was read before
      // this transaction and can otherwise be stale if a webhook settled or
      // reconciled a payment at the same time.
      const paymentId = reservation.payment?.id ?? null;
      if (paymentId) {
        await tx.$queryRaw`SELECT id FROM "Payment" WHERE id = ${paymentId} FOR UPDATE`;
      }
      const payment = paymentId
        ? await tx.payment.findUnique({ where: { id: paymentId }, include: { invoice: true } })
        : null;
      const transactions = payment
        ? await tx.transaction.findMany({
            where: { paymentId: payment.id },
            select: { id: true, amount: true, method: true, transactionType: true, paidAt: true, isDeleted: true, stripePaymentIntentId: true, stripeCheckoutSessionId: true },
          })
        : [];
      const claim = await tx.formationReservation.updateMany({
        where: { id: reservationId, status: { in: ["PENDING_DEPOSIT", "CONFIRMED"] } },
        data: {
          status: "CANCELLED",
          cancelledAt: new Date(),
          cancelledByUserId: session.user.id,
          // Nothing is owed on a cancelled booking. Left standing, this is the
          // figure the counter would read as a collectable balance.
          balanceDue: 0,
          notes: reason
            ? `${reservation.notes ? `${reservation.notes}\n` : ""}${refundPayment ? "Annulation avec remboursement exceptionnel" : "Annulation"} : ${reason}`
            : reservation.notes,
        },
      });
      if (claim.count === 0) return { claimed: false, refundQueued: false, queuedRefundAmount: 0 };

      // A cancelled booking never collects another cent, whatever happens to
      // the money already taken — refunded, forfeited, or neither. Set once
      // here rather than inside each money branch below, because there are
      // three payment updates across the two cancellation files and only the
      // forfeit one was obvious: the refund branch left 28 workshop payments
      // reading "REFUNDED" and "still owes €60" at the same time.
      //
      // Only the forward-looking field moves. paymentType (DEPOSIT),
      // totalAmount (the full price), paidAmount (what actually arrived) and
      // the DEPOSIT transaction row all stay, so the record still shows a
      // part-payment on a larger booking. paidAmount is what the revenue
      // reports sum, so income is untouched.
      if (payment) {
        await tx.payment.update({ where: { id: payment.id }, data: { remainingAmount: 0 } });
      }

      let refundQueued = false;
      let queuedRefundAmount = 0;
      if (refundPayment && payment) {
        const alreadyRefunded = transactions
          .filter((transaction) => transaction.transactionType === "REFUND" && !transaction.isDeleted)
          .reduce((sum, transaction) => sum + Number(transaction.amount), 0);
        const remainingRefund = Math.max(0, Number(payment.paidAmount) - alreadyRefunded);

        if (remainingRefund > 0.01) {
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
            paymentId: payment.id, source: "FORMATION", trigger: "SALON_CANCELLATION",
            reason: reason.trim(), amount: remainingRefund, transactions, creditNoteId,
            invoiceId: payment.invoice?.id ?? null, decidedByUserId: session.user.id,
            customerIsBusiness: isBusinessRefundCustomer(reservation.customer),
          });
          refundQueued = Boolean(queued);
          queuedRefundAmount = queued ? remainingRefund : 0;
        }
      } else if (!refundPayment && payment && Number(payment.paidAmount) > 0.01 && !payment.invoice) {
      // Deposit kept, not refunded — this is now final, non-refundable
      // revenue, and Belgian law requires an invoice for it just as much as
      // for a normally-settled reservation (see settleReservation's own
      // issueInvoice call). Never invoiced at collection time (see
      // lib/reservations/settle-reservation.js's doc comment), so this is
      // the only point where that invoice gets issued for a forfeited
      // deposit.
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
      }
      return { claimed: true, refundQueued, queuedRefundAmount };
    });
    if (!cancellation.claimed) {
      return { success: false, message: "Cette réservation ne peut plus être annulée." };
    }
    const { refundQueued, queuedRefundAmount } = cancellation;

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
    if (error.message === "REFUND_ALLOCATION_INCOMPLETE") {
      return { success: false, message: "Le détail des encaissements ne permet pas de préparer ce remboursement en toute sécurité. La réservation n'a pas été annulée ; vérifiez l'opération dans la réconciliation." };
    }
    console.error("[cancelFormationReservation]", error);
    return { success: false, message: "Erreur lors de l'annulation." };
  }
}

/**
 * Returns fresh, admin-only transfer choices. Keeping this query separate
 * from the reservation list prevents every dashboard row from carrying the
 * whole future formation catalogue, and makes the capacity preview current
 * when the modal opens.
 */
export async function getFormationTransferOptions(reservationId) {
  try {
    const session = await auth();
    if (!session?.user || !isAdminRole(session.user.role)) {
      return { success: false, message: "Non autorisé.", data: null };
    }

    const now = new Date();
    const [reservation, targetSessions] = await Promise.all([
      prisma.formationReservation.findUnique({
        where: { id: reservationId },
        include: {
          session: { include: { formation: true } },
          payment: {
            include: {
              invoice: { include: { creditNotes: { select: { id: true } } } },
              refundOperations: { select: { id: true } },
              transactions: { where: { transactionType: "REFUND", isDeleted: false }, select: { id: true } },
            },
          },
        },
      }),
      prisma.formationSession.findMany({
        where: {
          status: "SCHEDULED",
          startDate: { gt: now },
          formation: { status: "PUBLISHED" },
        },
        orderBy: [{ formation: { title: "asc" } }, { startDate: "asc" }],
        include: {
          formation: { select: { id: true, title: true, price: true } },
          reservations: {
            where: liveSeatFilter(now),
            select: { seatsCount: true },
          },
        },
      }),
    ]);

    if (!reservation) return { success: false, message: transferErrorMessage("RESERVATION_NOT_FOUND"), data: null };

    const payment = reservation.payment;
    // A fresh, never-corrected invoice no longer blocks the transfer — it is
    // superseded (credit note + replacement) as part of it. Only an invoice
    // that already has a credit note against it (already manually corrected)
    // is genuinely ambiguous and still routed to manual handling.
    const hasCreditedInvoice = Boolean(payment?.invoice?.creditNotes?.length);
    const hasRefundHistory = Boolean(payment?.refundOperations?.length || payment?.transactions?.length);
    const paidAmount = money(payment?.paidAmount ?? reservation.depositAmount);
    const discountAmount = money(payment?.discountAmount ?? reservation.discountAmount);

    const options = targetSessions
      .filter((target) => target.id !== reservation.sessionId)
      .map((target) => {
        const occupied = target.reservations.reduce((sum, item) => sum + item.seatsCount, 0);
        const availableSeats = Math.max(0, target.capacity - occupied);
        const targetTotal = money(Math.max(0, Number(target.formation.price) * reservation.seatsCount - discountAmount));
        return {
          id: target.id,
          activityId: target.formation.id,
          activityTitle: target.formation.title,
          startDate: target.startDate.toISOString(),
          availableSeats,
          catalogueUnitPrice: money(target.formation.price),
          targetTotal,
          priceDifference: money(targetTotal - Number(reservation.totalPrice)),
        };
      })
      .filter((target) => target.availableSeats >= reservation.seatsCount);

    return {
      success: true,
      data: {
        currentTotal: money(reservation.totalPrice),
        paidAmount,
        balanceDue: money(reservation.balanceDue),
        discountAmount,
        seatsCount: reservation.seatsCount,
        blockedReason:
          reservation.status !== "CONFIRMED"
            ? transferErrorMessage("RESERVATION_NOT_CONFIRMED")
            : reservation.checkedInSeats > 0
              ? transferErrorMessage("RESERVATION_ALREADY_CHECKED_IN")
              : !payment
                ? transferErrorMessage("PAYMENT_NOT_FOUND")
                : hasCreditedInvoice
                  ? transferErrorMessage("LEGAL_DOCUMENT_EXISTS")
                  : hasRefundHistory || ["REFUNDED", "PARTIALLY_REFUNDED", "REFUND_PENDING", "REFUND_FAILED"].includes(payment.status)
                    ? transferErrorMessage("PAYMENT_UNDER_REFUND")
                    : null,
        // Non-blocking: surfaced so the modal can warn the admin the
        // transfer will void this invoice (credit note) and, once the new
        // total is settled, issue a replacement.
        existingInvoiceNumber: payment?.invoice && !hasCreditedInvoice ? payment.invoice.number : null,
        options,
      },
    };
  } catch (error) {
    console.error("[getFormationTransferOptions]", error);
    return { success: false, message: "Impossible de charger les séances disponibles.", data: null };
  }
}

/**
 * Admin-only correction: move a confirmed formation reservation to any
 * future published formation session without charging a fee. Capacity,
 * pricing, payment and audit changes commit atomically. Stripe is never
 * called from this action. Structural sibling of
 * changeReservationSession in actions/workshops/manage-reservation.js —
 * formations have no seat-change-fee legacy path, so there is no equivalent
 * of that file's changeReservationSeats to keep this separate from.
 */
export async function changeFormationReservationSession(reservationId, newSessionId, { reason, priceDecision } = {}) {
  const normalizedReason = typeof reason === "string" ? reason.trim() : "";
  if (!reservationId || !newSessionId || !normalizedReason || normalizedReason.length > 500) {
    return { success: false, message: transferErrorMessage("INVALID_TRANSFER_INPUT") };
  }

  try {
    const authSession = await auth();
    if (!authSession?.user || !isAdminRole(authSession.user.role)) {
      return { success: false, message: "Non autorisé." };
    }

    const result = await prisma.$transaction(async (tx) => {
      // Lock in deterministic order to serialize both capacity and concurrent
      // changes of the same reservation without introducing a deadlock.
      await tx.$queryRaw`SELECT id FROM formation_reservations WHERE id = ${reservationId} FOR UPDATE`;
      const sessionIds = [newSessionId];

      const reservation = await tx.formationReservation.findUnique({
        where: { id: reservationId },
        include: {
          session: { include: { formation: true } },
          // billingProfile is required by buildInvoiceCustomer whenever this
          // reservation's invoice has to be re-issued below (a B2B customer's
          // legal name/BCE number/PO reference live there, not on User).
          customer: { include: { billingProfile: true } },
          payment: {
            include: {
              invoice: { include: { creditNotes: { select: { id: true } } } },
              refundOperations: { select: { id: true, status: true } },
              transactions: { where: { transactionType: "REFUND", isDeleted: false }, select: { id: true } },
            },
          },
        },
      });
      if (!reservation) throw new Error("RESERVATION_NOT_FOUND");
      if (reservation.status !== "CONFIRMED") throw new Error("RESERVATION_NOT_CONFIRMED");
      if (reservation.checkedInSeats > 0) throw new Error("RESERVATION_ALREADY_CHECKED_IN");
      if (reservation.sessionId === newSessionId) throw new Error("SAME_SESSION");

      sessionIds.push(reservation.sessionId);
      for (const id of sessionIds.sort()) {
        await tx.$queryRaw`SELECT id FROM formation_sessions WHERE id = ${id} FOR UPDATE`;
      }

      const target = await tx.formationSession.findUnique({
        where: { id: newSessionId },
        include: { formation: true },
      });
      if (!target || target.status !== "SCHEDULED" || target.formation.status !== "PUBLISHED" || target.startDate <= new Date()) {
        throw new Error("TARGET_SESSION_NOT_AVAILABLE");
      }

      const occupiedByOthers = await sessionOccupancy(tx, {
        kind: OCCUPANCY_KINDS.FORMATION,
        sessionId: target.id,
        excludeReservationId: reservation.id,
      });
      if (occupiedByOthers + reservation.seatsCount > target.capacity) {
        throw new Error("TARGET_SESSION_FULL");
      }

      const payment = reservation.payment;
      if (!payment) throw new Error("PAYMENT_NOT_FOUND");
      if (
        payment.transactions.length > 0 ||
        payment.refundOperations.length > 0 ||
        ["REFUNDED", "PARTIALLY_REFUNDED", "REFUND_PENDING", "REFUND_FAILED"].includes(payment.status)
      ) {
        throw new Error("PAYMENT_UNDER_REFUND");
      }
      // A fresh, never-corrected invoice no longer blocks the transfer — see
      // the supersession block below. Only one already credited (genuinely
      // ambiguous — was it already corrected for another reason?) still is.
      if (payment.invoice?.creditNotes?.length) throw new Error("LEGAL_DOCUMENT_EXISTS");

      const oldTotal = money(reservation.totalPrice);
      const paidAmount = money(payment.paidAmount);
      const discountAmount = money(payment.discountAmount ?? reservation.discountAmount);
      const targetTotal = money(Math.max(0, Number(target.formation.price) * reservation.seatsCount - discountAmount));
      const priceDifference = money(targetTotal - oldTotal);

      let effectiveTotal = oldTotal;
      let effectiveDecision = "SAME_PRICE";
      if (priceDifference > 0) {
        if (!Object.values(TRANSFER_PRICE_DECISIONS).includes(priceDecision)) {
          throw new Error("PRICE_DECISION_REQUIRED");
        }
        effectiveDecision = priceDecision;
        effectiveTotal = priceDecision === TRANSFER_PRICE_DECISIONS.APPLY_TARGET_PRICE ? targetTotal : oldTotal;
      } else if (priceDifference < 0) {
        if (priceDecision && priceDecision !== TRANSFER_PRICE_DECISIONS.APPLY_TARGET_PRICE) {
          throw new Error("INVALID_PRICE_DECISION");
        }
        effectiveDecision = TRANSFER_PRICE_DECISIONS.APPLY_TARGET_PRICE;
        effectiveTotal = targetTotal;
      }

      if (paidAmount > effectiveTotal + 0.01) throw new Error("OVERPAYMENT_REQUIRES_MANUAL_HANDLING");

      const newBalanceDue = money(Math.max(0, effectiveTotal - paidAmount));
      const newPaymentStatus = newBalanceDue <= 0.01 ? "PAID" : paidAmount > 0.01 ? "PARTIALLY_PAID" : "PENDING";
      const oldSessionId = reservation.sessionId;

      // This reservation was invoiced immediately at booking (only path: a
      // B2B customer paying 100% upfront). Belgian VAT law forbids editing
      // or deleting that invoice, so the correction is its own documents: a
      // full credit note now, and — only once the new total is fully
      // covered by what's already paid — a brand-new invoice. If the
      // transfer leaves a balance due, no replacement is issued here;
      // settleReservation issues one later exactly as it would for any
      // booking not yet fully settled.
      let invoiceReplacement = null;
      if (payment.invoice) {
        const { creditNote } = await supersedeInvoice(tx, {
          invoice: payment.invoice,
          reason: `Transfert vers une nouvelle séance — ${normalizedReason}`,
        });
        let newInvoice = null;
        if (newBalanceDue <= 0.01) {
          try {
            newInvoice = await issueInvoice(tx, {
              paymentId: payment.id,
              source: "FORMATION",
              totalInclVat: effectiveTotal,
              customer: buildInvoiceCustomer(reservation.customer),
              lines: buildServiceInvoiceLines({
                description: `${target.formation.title} (${reservation.seatsCount} place${reservation.seatsCount > 1 ? "s" : ""})`,
                totalAmount: effectiveTotal,
                discountAmount,
              }),
              supersedesInvoiceId: payment.invoice.id,
            });
          } catch (reissueError) {
            // This customer plainly is invoiceable (they held an invoice a
            // moment ago) — the generic B2C message would be misleading.
            if (reissueError.message === "B2C_INVOICE_NOT_ALLOWED") {
              throw new Error("INVOICE_REPLACEMENT_VAT_EXPIRED");
            }
            throw reissueError;
          }
        }
        // Shaped for OperationDocumentsDialog/DocumentDeliveryDialog
        // (components/dashboard/operations) — the same PDF-open/e-mail/Peppyrus
        // machinery every other invoice and credit note in Operations already
        // uses. Supersession only ever fires for an invoiceable (B2B)
        // customer, so customerType/customerVatNumber are known without an
        // extra query.
        invoiceReplacement = {
          previousInvoice: {
            id: payment.invoice.id,
            number: payment.invoice.number,
            customerType: "B2B",
            customerVatNumber: reservation.customer.vatNumber,
          },
          creditNote: { id: creditNote.id, number: creditNote.number },
          newInvoice: newInvoice
            ? {
                id: newInvoice.id,
                number: newInvoice.number,
                customerType: "B2B",
                customerVatNumber: reservation.customer.vatNumber,
              }
            : null,
        };
      }

      await tx.formationReservation.update({
        where: { id: reservation.id },
        data: {
          sessionId: target.id,
          totalPrice: effectiveTotal,
          balanceDue: newBalanceDue,
        },
      });
      await tx.payment.update({
        where: { id: payment.id },
        data: { totalAmount: effectiveTotal, remainingAmount: newBalanceDue, status: newPaymentStatus },
      });

      await writeAuditLog(tx, {
        action: AUDIT_ACTIONS.RESERVATION_SESSION_TRANSFERRED,
        entityType: "FormationReservation",
        entityId: reservation.id,
        actor: authSession.user,
        before: {
          sessionId: oldSessionId,
          activityId: reservation.session.formationId,
          activityTitle: reservation.session.formation.title,
          sessionStartDate: reservation.session.startDate,
          totalPrice: oldTotal,
          balanceDue: money(reservation.balanceDue),
        },
        after: {
          sessionId: target.id,
          activityId: target.formationId,
          activityTitle: target.formation.title,
          sessionStartDate: target.startDate,
          totalPrice: effectiveTotal,
          balanceDue: newBalanceDue,
        },
        metadata: {
          reason: normalizedReason,
          seatsCount: reservation.seatsCount,
          paidAmount,
          catalogueTargetTotal: targetTotal,
          priceDifference,
          priceDecision: effectiveDecision,
          waivedAmount: effectiveDecision === TRANSFER_PRICE_DECISIONS.KEEP_CURRENT_PRICE ? priceDifference : 0,
          automaticRefund: false,
          modificationFee: 0,
          ...(invoiceReplacement ? { invoiceReplacement } : {}),
        },
      });

      return {
        oldSessionId,
        previousActivityTitle: reservation.session.formation.title,
        previousSessionDate: reservation.session.startDate,
        newActivityTitle: target.formation.title,
        newSessionDate: target.startDate,
        customer: { fullName: reservation.customer.fullName, email: reservation.customer.email },
        totalPrice: effectiveTotal,
        paidAmount,
        balanceDue: newBalanceDue,
        priceDecision: effectiveDecision,
        invoiceReplacement,
      };
    }, { timeout: 15_000 }); // Prisma's 5s default is too tight once an invoiced
    // reservation is being transferred: superseding adds a credit note and a
    // replacement invoice, each allocating a gapless number under its own
    // query, on top of the row locks and capacity checks already here.

    notifyAllInFormationWaitingList(result.oldSessionId).catch((error) =>
      console.error("[changeFormationReservationSession] waiting-list notify failed:", error)
    );
    const emailResult = await sendEmail({
      to: result.customer.email,
      ...formationSessionChangeEmail({
        customerName: result.customer.fullName,
        previousFormationTitle: result.previousActivityTitle,
        newFormationTitle: result.newActivityTitle,
        previousSessionDate: formatSessionDate(result.previousSessionDate),
        newSessionDate: formatSessionDate(result.newSessionDate),
        totalPrice: result.totalPrice,
        paidAmount: result.paidAmount,
        balanceDue: result.balanceDue,
      }),
    }).catch((error) => {
      console.error("[changeFormationReservationSession] confirmation email failed:", error);
      return { success: false };
    });

    revalidatePath("/dashboard/formations/reservations");
    revalidatePath("/dashboard/operations");
    const { invoiceReplacement } = result;
    const documentNote = invoiceReplacement
      ? ` Note de crédit n°${invoiceReplacement.creditNote.number}${
          invoiceReplacement.newInvoice ? ` et nouvelle facture n°${invoiceReplacement.newInvoice.number}` : ""
        } émise${invoiceReplacement.newInvoice ? "s" : ""} — à transmettre au client depuis Opérations.`
      : "";
    return {
      success: true,
      message: emailResult?.success
        ? `Réservation transférée sans frais et e-mail de confirmation envoyé.${documentNote}`
        : `Réservation transférée sans frais, mais l'e-mail n'a pas pu être envoyé. Renvoyez une confirmation au client.${documentNote}`,
      emailSent: Boolean(emailResult?.success),
      data: { totalPrice: result.totalPrice, paidAmount: result.paidAmount, balanceDue: result.balanceDue, invoiceReplacement },
    };
  } catch (error) {
    if (error.message === "BUYER_LEGAL_DATA_INCOMPLETE") {
      return { success: false, message: error.userMessage || transferErrorMessage(error.message) };
    }
    const knownMessage = transferErrorMessage(error?.message);
    if (knownMessage !== "Erreur lors du transfert de la réservation.") {
      return { success: false, message: knownMessage };
    }
    console.error("[changeFormationReservationSession]", error);
    return { success: false, message: knownMessage };
  }
}

/**
 * Free counter seat-count change on a CONFIRMED formation reservation — see
 * lib/reservations/change-reservation-seats.js for the pricing/invoicing
 * rules. Formations have no paid Stripe seat-change flow to collide with
 * (that legacy path only exists for workshops); gated on the same
 * settlement capability as closing a booking out, not admin-only.
 */
export async function changeFormationReservationSeatsFree(reservationId, { newSeatsCount, reason } = {}) {
  const session = await auth();
  if (!session?.user) return { success: false, message: "Non authentifié." };
  const authorization = await authorizeActivityReservationOperation({
    kind: ACTIVITY_RESERVATION_KINDS.FORMATION,
    reservationId,
    user: session.user,
    capability: STAFF_PERMISSIONS.ACTIVITY_SETTLEMENTS,
  });
  if (!authorization.success) return authorization;

  const result = await changeReservationSeatsFree({
    kind: "FORMATION",
    reservationId,
    newSeatsCount,
    reason,
    actorId: session.user.id,
  });

  if (result.success) revalidatePath(RESERVATION_KINDS.FORMATION.revalidatePath);
  return result;
}

/**
 * Closes out a formation reservation. Admins may close every reservation;
 * staff require the explicit settlement capability and an assignment to the
 * formation or the particular session.
 */
export async function completeFormationReservation(
  reservationId,
  { method, paymentConfirmed, terminalApproved, terminalReference, finalTotal, adjustmentReason } = {}
) {
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
    terminalApproved,
    terminalReference,
    finalTotal,
    adjustmentReason,
    actorId: session.user.id,
    actor: session.user,
  });

  if (result.success) {
    revalidatePath(RESERVATION_KINDS.FORMATION.revalidatePath);
    // Gated purely on the acting staff member's SEND_TICKET_EMAIL
    // permission — sendTicketByEmail re-derives auth() itself and checks it
    // internally, so no separate permission check is needed here. Fire-and-
    // forget: a ticket failure must never turn a successful settlement into
    // an error response. Only when a balance was actually collected — a
    // booking closed with nothing new to collect gets nothing new sent.
    if (result.balance > 0) {
      sendTicketByEmail(result.paymentId, { transactionId: result.transactionId }).catch((err) =>
        console.error("[completeFormationReservation] ticket send failed", err),
      );
    }
  }
  const { paymentId, transactionId, balance, ...publicResult } = result;
  return publicResult;
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

