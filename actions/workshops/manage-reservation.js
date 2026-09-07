"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { stripe } from "@/lib/stripe";
import { sendEmail } from "@/lib/email";
import { workshopCancellationEmail, workshopSessionChangeEmail } from "@/lib/email-templates";
import { isAdminRole, STAFF_PERMISSIONS } from "@/lib/authorization";
import {
  ACTIVITY_RESERVATION_KINDS,
  authorizeActivityReservationOperation,
} from "@/lib/activity-reservation-access";
import { notifyAllInWaitingList } from "@/lib/workshops/notify-waiting-list";
import { checkWorkshopSessionAvailability } from "@/actions/workshops/create-workshop-reservation";
import { issueCreditNote, issueInvoice, supersedeInvoice, buildInvoiceCustomer, buildServiceInvoiceLines } from "@/lib/invoicing";
import { queueManualRefund } from "@/lib/refunds/queue-manual-refund";
import { settleReservation, markReservationNoShow, RESERVATION_KINDS } from "@/lib/reservations/settle-reservation";
import { hasInvoiceableVatIdentity } from "@/lib/tax-policy";
import { isBusinessRefundCustomer } from "@/lib/refunds/document-policy";
import { AUDIT_ACTIONS, writeAuditLog } from "@/lib/audit-log";

// The 10% charge remains limited to seat-count changes. Moving a customer to
// another session/activity is an admin correction and is free of charge.
const SESSION_CHANGE_FEE_RATE = 0.1;

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
 * Admin-only: cancels a reservation on a customer's behalf. Deposits are
 * non-refundable by default (see req: "no refund once paid the deposit") —
 * enforced here since there's no customer self-service cancel flow in this
 * app. The client confirmed exceptions should exist for medical reasons,
 * death, or genuine force majeure — `refundDeposit` is the admin's manual
 * case-by-case call, never automatic, so `reason` is required whenever it's
 * used (it's what justifies the exception in the reservation's own record).
 *
 * No time cutoff before the session: unlike a customer self-service window,
 * this is a trusted admin acting on a case she's already reviewed — the
 * most urgent exceptions (a customer hospitalized the day of the session)
 * are also the ones closest to the session date, so a cutoff here would
 * block the admin from honoring exactly the force-majeure promise made in
 * the CGV.
 */
export async function cancelWorkshopReservation(reservationId, { reason, refundDeposit = false } = {}) {
  try {
    const session = await auth();
    if (!session?.user) {
      return { success: false, message: "Non authentifié." };
    }
    if (!isAdminRole(session.user.role)) {
      // Deletion = client-facing cancellation, kept admin-only to avoid disputes.
      return { success: false, message: "Non autorisé." };
    }

    if (refundDeposit && !reason?.trim()) {
      return { success: false, message: "Un motif est requis pour rembourser l'acompte à titre exceptionnel." };
    }

    const reservation = await prisma.workshopReservation.findUnique({
      where: { id: reservationId },
      include: {
        session: { include: { workshop: true } },
        customer: { include: { billingProfile: true } },
        payment: { include: { invoice: true } },
      },
    });
    if (!reservation) {
      return { success: false, message: "Réservation introuvable." };
    }
    if (reservation.status === "CANCELLED") {
      return { success: false, message: "Cette réservation est déjà annulée." };
    }

    const noteLine = refundDeposit
      ? `Annulation (acompte remboursé à titre exceptionnel) : ${reason}`
      : reason
      ? `Annulation : ${reason}`
      : null;

    // Deposits are non-refundable by default. When an admin grants an
    // exception, this no longer moves the money itself — confirmed policy
    // (2026-09-02): every Stripe refund is performed by hand in the Stripe
    // dashboard by an OWNER/ADMIN.
    //
    // The credit note is still issued here exactly as before. What replaces
    // the Stripe call is a RefundOperation whose legs carry the precise
    // amount and payment_intent to refund against; it sits at the top of
    // /dashboard/operations until someone has actually done it, and the
    // charge.refunded webhook settles it. Deleting the call without this
    // would have left the customer credited on paper and never paid — the
    // exact state scripts/audit-refund-states.mjs found nine times.
    //
    // Note this no longer requires payment.transactionReference: a
    // reservation settled in cash used to fall through here refunding
    // nothing AND issuing no credit note. Cash now queues a hand-over leg
    // like any other method.
    const cancellation = await prisma.$transaction(async (tx) => {
      // Claim and every financial side effect deliberately share this
      // transaction. A failure to issue the legal document or worklist rolls
      // back the cancellation too; a cancelled seat can never be left without
      // its associated refund dossier.
      // The reservation was loaded before entering this transaction. Lock and
      // reload its payment so a concurrent webhook cannot make us calculate a
      // refund from stale amounts, transactions, or invoice data.
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
      const claim = await tx.workshopReservation.updateMany({
        where: { id: reservationId, status: { in: ["PENDING_DEPOSIT", "CONFIRMED"] } },
        data: {
          status: "CANCELLED",
          cancelledAt: new Date(),
          cancelledByUserId: session.user.id,
          // Nothing is owed on a cancelled booking. Left standing, this is the
          // figure the counter would read as a collectable balance.
          balanceDue: 0,
          notes: noteLine ? `${reservation.notes ? `${reservation.notes}\n` : ""}${noteLine}` : reservation.notes,
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
      if (refundDeposit && payment) {
        const priorRefunds = await tx.transaction.aggregate({
          where: { paymentId: payment.id, transactionType: "REFUND", isDeleted: false },
          _sum: { amount: true },
        });
        const remaining = Number(payment.paidAmount) - Number(priorRefunds._sum.amount ?? 0);

        if (remaining <= 0.01 && Number(payment.paidAmount) > 0.01) {
          await tx.payment.update({ where: { id: payment.id }, data: { status: "REFUNDED" } });
        } else {
          let creditNoteId = null;
          if (payment.invoice) {
            const creditNote = await issueCreditNote(tx, {
              invoiceId: payment.invoice.id,
              reason: reason || "Annulation atelier — remboursement exceptionnel",
              totalInclVat: remaining,
            });
            creditNoteId = creditNote.id;
          }
          const queued = await queueManualRefund(tx, {
            paymentId: payment.id, source: "WORKSHOP", trigger: "SALON_CANCELLATION",
            reason: reason || "Annulation atelier — remboursement exceptionnel", amount: remaining,
            transactions, creditNoteId, invoiceId: payment.invoice?.id ?? null,
            decidedByUserId: session.user.id, activityType: reservation.session.workshop.type,
            customerIsBusiness: isBusinessRefundCustomer(reservation.customer),
          });
          refundQueued = Boolean(queued);
          queuedRefundAmount = queued ? remaining : 0;
        }
      } else if (!refundDeposit && payment && Number(payment.paidAmount) > 0.01 && !payment.invoice) {
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
            source: "WORKSHOP",
            totalInclVat: Number(payment.paidAmount),
            customer: buildInvoiceCustomer(reservation.customer),
            lines: buildServiceInvoiceLines({
              description: `Annulation — acompte non remboursable — ${reservation.session.workshop.title}`,
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

    notifyAllInWaitingList(reservation.sessionId).catch((err) =>
      console.error("[cancelWorkshopReservation] waiting-list notify failed:", err)
    );

    sendEmail({
      to: reservation.customer.email,
      ...workshopCancellationEmail({
        customerName: reservation.customer.fullName,
        activityTitle: reservation.session.workshop.title,
        sessionDate: formatSessionDate(reservation.session.startDate),
        // Never `refunded: true` here — the money has NOT moved at this
        // point; an admin still has to refund it in Stripe or hand it over,
        // and lib/refunds/notify-refund-complete.js announces that later,
        // once. But `false` alone used to mean "l'acompte n'est pas
        // remboursable", which told a customer whose refund had just been
        // approved the exact opposite. Hence the third state.
        refunded: false,
        refundPending: refundQueued,
        refundAmount: refundQueued ? queuedRefundAmount : null,
        decisionNote: reason?.trim() || null,
      }),
    }).catch((err) => console.error("[cancelWorkshopReservation] email failed:", err));

    revalidatePath("/dashboard/workshops/reservations");
    revalidatePath("/dashboard/operations");
    return {
      success: true,
      message: refundDeposit
        ? refundQueued
          ? "Réservation annulée. Le remboursement est à effectuer — voir « Remboursements dus » dans Opérations."
          : "Réservation annulée. Aucun montant restant à rembourser."
        : "Réservation annulée.",
      refundQueued,
    };
  } catch (error) {
    if (error.message === "REFUND_ALREADY_PENDING") {
      return { success: false, message: "Un remboursement est déjà en cours pour cette réservation — attendez sa résolution avant de réessayer." };
    }
    if (error.message === "REFUND_ALLOCATION_INCOMPLETE") {
      return { success: false, message: "Le détail des encaissements ne permet pas de préparer ce remboursement en toute sécurité. La réservation n'a pas été annulée ; vérifiez l'opération dans la réconciliation." };
    }
    console.error("[cancelWorkshopReservation]", error);
    return { success: false, message: "Erreur lors de l'annulation." };
  }
}

/**
 * Returns fresh, admin-only transfer choices. Keeping this query separate
 * from the reservation list prevents every dashboard row from carrying the
 * whole future activity catalogue, and makes the capacity preview current
 * when the modal opens.
 */
export async function getWorkshopTransferOptions(reservationId) {
  try {
    const session = await auth();
    if (!session?.user || !isAdminRole(session.user.role)) {
      return { success: false, message: "Non autorisé.", data: null };
    }

    const now = new Date();
    const [reservation, targetSessions] = await Promise.all([
      prisma.workshopReservation.findUnique({
        where: { id: reservationId },
        include: {
          session: { include: { workshop: true } },
          payment: {
            include: {
              invoice: { include: { creditNotes: { select: { id: true } } } },
              refundOperations: { select: { id: true } },
              transactions: { where: { transactionType: "REFUND", isDeleted: false }, select: { id: true } },
            },
          },
        },
      }),
      prisma.workshopSession.findMany({
        where: {
          status: "SCHEDULED",
          startDate: { gt: now },
          workshop: { status: "PUBLISHED" },
        },
        orderBy: [{ workshop: { title: "asc" } }, { startDate: "asc" }],
        include: {
          workshop: { select: { id: true, title: true, type: true, price: true } },
          reservations: {
            where: {
              OR: [
                { status: { in: ["CONFIRMED", "COMPLETED"] } },
                { status: "PENDING_DEPOSIT", OR: [{ holdExpiresAt: null }, { holdExpiresAt: { gt: now } }] },
              ],
            },
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
        const targetTotal = money(Math.max(0, Number(target.workshop.price) * reservation.seatsCount - discountAmount));
        return {
          id: target.id,
          activityId: target.workshop.id,
          activityTitle: target.workshop.title,
          activityType: target.workshop.type,
          startDate: target.startDate.toISOString(),
          availableSeats,
          catalogueUnitPrice: money(target.workshop.price),
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
        // total is settled, issue a replacement — see changeReservationSession.
        existingInvoiceNumber: payment?.invoice && !hasCreditedInvoice ? payment.invoice.number : null,
        options,
      },
    };
  } catch (error) {
    console.error("[getWorkshopTransferOptions]", error);
    return { success: false, message: "Impossible de charger les séances disponibles.", data: null };
  }
}

/**
 * Admin-only correction: move a confirmed workshop/event reservation to any
 * future published workshop/event session without charging a 10% fee.
 * Capacity, pricing, payment and audit changes commit atomically. Stripe is
 * never called from this action.
 */
export async function changeReservationSession(reservationId, newSessionId, { reason, priceDecision } = {}) {
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
      await tx.$queryRaw`SELECT id FROM workshop_reservations WHERE id = ${reservationId} FOR UPDATE`;
      const sessionIds = [newSessionId];

      const reservation = await tx.workshopReservation.findUnique({
        where: { id: reservationId },
        include: {
          session: { include: { workshop: true } },
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
        await tx.$queryRaw`SELECT id FROM workshop_sessions WHERE id = ${id} FOR UPDATE`;
      }

      const target = await tx.workshopSession.findUnique({
        where: { id: newSessionId },
        include: { workshop: true },
      });
      if (!target || target.status !== "SCHEDULED" || target.workshop.status !== "PUBLISHED" || target.startDate <= new Date()) {
        throw new Error("TARGET_SESSION_NOT_AVAILABLE");
      }

      const occupied = await tx.workshopReservation.aggregate({
        where: {
          sessionId: target.id,
          id: { not: reservation.id },
          OR: [
            { status: { in: ["CONFIRMED", "COMPLETED"] } },
            { status: "PENDING_DEPOSIT", OR: [{ holdExpiresAt: null }, { holdExpiresAt: { gt: new Date() } }] },
          ],
        },
        _sum: { seatsCount: true },
      });
      if ((occupied._sum.seatsCount ?? 0) + reservation.seatsCount > target.capacity) {
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
      const targetTotal = money(Math.max(0, Number(target.workshop.price) * reservation.seatsCount - discountAmount));
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

      // This reservation was invoiced immediately at booking (only path:
      // a B2B customer paying 100% upfront — see
      // fulfill-workshop-reservation-payment.js). Belgian VAT law forbids
      // editing or deleting that invoice, so the correction is its own
      // documents: a full credit note now, and — only once the new total is
      // fully covered by what's already paid — a brand-new invoice. If the
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
              source: "WORKSHOP",
              totalInclVat: effectiveTotal,
              customer: buildInvoiceCustomer(reservation.customer),
              lines: buildServiceInvoiceLines({
                description: `${target.workshop.title} (${reservation.seatsCount} place${reservation.seatsCount > 1 ? "s" : ""})`,
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
        invoiceReplacement = {
          previousInvoiceNumber: payment.invoice.number,
          creditNoteNumber: creditNote.number,
          newInvoiceNumber: newInvoice?.number ?? null,
        };
      }

      await tx.workshopReservation.update({
        where: { id: reservation.id },
        data: {
          sessionId: target.id,
          previousSessionId: oldSessionId,
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
        entityType: "WorkshopReservation",
        entityId: reservation.id,
        actor: authSession.user,
        before: {
          sessionId: oldSessionId,
          activityId: reservation.session.workshopId,
          activityTitle: reservation.session.workshop.title,
          sessionStartDate: reservation.session.startDate,
          totalPrice: oldTotal,
          balanceDue: money(reservation.balanceDue),
        },
        after: {
          sessionId: target.id,
          activityId: target.workshopId,
          activityTitle: target.workshop.title,
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
        previousActivityTitle: reservation.session.workshop.title,
        previousSessionDate: reservation.session.startDate,
        newActivityTitle: target.workshop.title,
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

    notifyAllInWaitingList(result.oldSessionId).catch((error) =>
      console.error("[changeReservationSession] waiting-list notify failed:", error)
    );
    const emailResult = await sendEmail({
      to: result.customer.email,
      ...workshopSessionChangeEmail({
        customerName: result.customer.fullName,
        activityTitle: result.newActivityTitle,
        previousActivityTitle: result.previousActivityTitle,
        newActivityTitle: result.newActivityTitle,
        previousSessionDate: formatSessionDate(result.previousSessionDate),
        newSessionDate: formatSessionDate(result.newSessionDate),
        totalPrice: result.totalPrice,
        paidAmount: result.paidAmount,
        balanceDue: result.balanceDue,
      }),
    }).catch((error) => {
      console.error("[changeReservationSession] confirmation email failed:", error);
      return { success: false };
    });

    revalidatePath("/dashboard/workshops/reservations");
    revalidatePath("/dashboard/operations");
    const { invoiceReplacement } = result;
    const documentNote = invoiceReplacement
      ? ` Note de crédit n°${invoiceReplacement.creditNoteNumber}${
          invoiceReplacement.newInvoiceNumber ? ` et nouvelle facture n°${invoiceReplacement.newInvoiceNumber}` : ""
        } émise${invoiceReplacement.newInvoiceNumber ? "s" : ""} — à transmettre au client depuis Opérations.`
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
    console.error("[changeReservationSession]", error);
    return { success: false, message: knownMessage };
  }
}

/**
 * Admin-only: changes the number of seats on an existing CONFIRMED
 * reservation, via a Stripe Checkout link.
 *
 * A flat 10% fee (of the reservation's original total price) always
 * applies, matching the confirmed pricing rule. On top of that, when seats
 * are being ADDED, the customer must also pay for the extra seats — at the
 * same paid ratio they originally chose (full payment or a deposit) — or
 * the salon is left owed the difference with no way to invoice it. Seat
 * DECREASES stay fee-only with no price/deposit adjustment: the deposit
 * policy is "never refunded regardless of reason," so removing seats
 * doesn't unwind money already collected for them.
 */
export async function changeReservationSeats(reservationId, newSeatsCount) {
  try {
    const session = await auth();
    if (!session?.user || !isAdminRole(session.user.role)) {
      return { success: false, message: "Non autorisé." };
    }

    const seats = Number(newSeatsCount);
    if (!Number.isInteger(seats) || seats < 1) {
      return { success: false, message: "Le nombre de places doit être un entier positif." };
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
    if (seats === reservation.seatsCount) {
      return { success: false, message: "Cette réservation a déjà ce nombre de places." };
    }

    const capacity = reservation.session.capacity ?? reservation.session.workshop.capacity;
    if (seats > capacity) {
      return { success: false, message: `La capacité maximale de cette séance est de ${capacity} personnes.` };
    }

    // Only enforce availability when INCREASING — the reservation's own
    // current seats already count as "taken," so the room available for
    // this change is what's free PLUS what this reservation already holds.
    if (seats > reservation.seatsCount) {
      const availability = await checkWorkshopSessionAvailability(reservation.sessionId);
      const roomForThisReservation = (availability.data?.available ?? 0) + reservation.seatsCount;
      if (!availability.success || seats > roomForThisReservation) {
        return { success: false, message: "Pas assez de places disponibles sur cette séance pour cette augmentation." };
      }
    }

    const changeFeeAmount = Number(reservation.totalPrice) * SESSION_CHANGE_FEE_RATE;

    // On an increase, the customer must also pay for the added seats — at
    // the same ratio they originally paid (1.0 for a full payment, the
    // deposit % for a deposit booking) — so the salon isn't left owed the
    // untracked difference. Computed once here and passed through Stripe
    // metadata so the webhook applies these exact figures rather than
    // re-deriving them from a reservation row that may have moved on.
    let priceDelta = 0;
    let newTotalPrice = Number(reservation.totalPrice);
    let newDepositAmount = Number(reservation.depositAmount);
    if (seats > reservation.seatsCount) {
      const unitPrice = Number(reservation.totalPrice) / reservation.seatsCount;
      const paidRatio = Number(reservation.depositAmount) / Number(reservation.totalPrice);
      newTotalPrice = unitPrice * seats;
      newDepositAmount = paidRatio * newTotalPrice;
      priceDelta = newDepositAmount - Number(reservation.depositAmount);
    }
    const amountToCharge = changeFeeAmount + priceDelta;

    const stripeSession = await stripe.checkout.sessions.create({
      payment_method_types: ["card"], // Bancontact disabled for now — see docs/QUESTIONS_FOR_MARIE.md
      line_items: [
        {
          price_data: {
            currency: "eur",
            product_data: {
              name: `Frais de modification - ${reservation.session.workshop.title}`,
              description: `Modification du nombre de places (${reservation.seatsCount} → ${seats})${
                priceDelta > 0 ? " — inclut le prix des places ajoutées" : ""
              }`,
            },
            unit_amount: Math.round(amountToCharge * 100),
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
        workshopAction: "seats_change_fee",
        reservationId: reservation.id,
        newSeatsCount: String(seats),
        changeFeeAmount: String(changeFeeAmount),
        newTotalPrice: String(newTotalPrice),
        newDepositAmount: String(newDepositAmount),
      },
      payment_intent_data: {
        metadata: {
          kind: "workshop",
          workshopAction: "seats_change_fee",
          reservationId: reservation.id,
        },
      },
    });

    return {
      success: true,
      message: "Lien de paiement généré. Envoyez-le au client pour finaliser le changement.",
      paymentUrl: stripeSession.url,
      changeFeeAmount: amountToCharge,
    };
  } catch (error) {
    console.error("[changeReservationSeats]", error);
    return { success: false, message: "Erreur lors de la modification du nombre de places." };
  }
}

/**
 * Closes out an atelier reservation. Admins may close every reservation;
 * staff require the explicit settlement capability and an assignment to the
 * atelier or the particular session.
 */
export async function completeWorkshopReservation(
  reservationId,
  { method, paymentConfirmed, terminalApproved, terminalReference, finalTotal, adjustmentReason } = {}
) {
  const session = await auth();
  if (!session?.user) return { success: false, message: "Non authentifié." };
  const authorization = await authorizeActivityReservationOperation({
    kind: ACTIVITY_RESERVATION_KINDS.WORKSHOP,
    reservationId,
    user: session.user,
    capability: STAFF_PERMISSIONS.ACTIVITY_SETTLEMENTS,
  });
  if (!authorization.success) return authorization;

  const result = await settleReservation({
    kind: "WORKSHOP",
    reservationId,
    method,
    paymentConfirmed,
    terminalApproved,
    terminalReference,
    finalTotal,
    adjustmentReason,
    actorId: session.user.id,
  });

  if (result.success) revalidatePath(RESERVATION_KINDS.WORKSHOP.revalidatePath);
  return result;
}

/** Records a no-show. Never refunds — the deposit is kept by design. */
export async function markWorkshopReservationNoShow(reservationId) {
  const session = await auth();
  if (!session?.user) return { success: false, message: "Non authentifié." };
  const authorization = await authorizeActivityReservationOperation({
    kind: ACTIVITY_RESERVATION_KINDS.WORKSHOP,
    reservationId,
    user: session.user,
    capability: STAFF_PERMISSIONS.ACTIVITY_ATTENDANCE,
  });
  if (!authorization.success) return authorization;

  const result = await markReservationNoShow({
    kind: "WORKSHOP",
    reservationId,
    actorId: session.user.id,
  });

  if (result.success) revalidatePath(RESERVATION_KINDS.WORKSHOP.revalidatePath);
  return result;
}

