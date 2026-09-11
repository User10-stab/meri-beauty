import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { issueInvoice, buildInvoiceCustomer, buildServiceInvoiceLines, resolveSettlementInvoice } from "@/lib/invoicing";
import { hasInvoiceableVatIdentity } from "@/lib/tax-policy";
import { captureError } from "@/lib/monitoring";
import { allocatePieceNumber, PIECE_SERIES, seriesForActivityType } from "@/lib/cash-book/piece-number";
import { revalidateCaisseRoutes } from "@/lib/cash-book/revalidate-caisse";
import { ensureCashSessionOpen } from "@/lib/cash-book/session-lifecycle";
import { resolveCounterPriceAdjustment } from "@/lib/payments/counter-price-adjustment";
import { AUDIT_ACTIONS } from "@/lib/audit-log";
import { isTillCashOperator } from "@/lib/authorization";

/**
 * The second half of the atelier/formation lifecycle, which never existed
 * before: collecting the on-site balance and closing the booking out.
 *
 * Ateliers and formations both take a 50% deposit online (confirmed policy —
 * ignore any doc still saying 30% for formations). The deposit is
 * deliberately NOT invoiced at payment time; the legally-required invoice is
 * issued once the full amount is settled, exactly as appointments do in
 * completeAppointment. Until this helper existed there was no way to reach
 * that second step for either flow: the balance could not be recorded, no
 * final invoice was ever issued (a TVA problem — every taxable service needs
 * one), and the Payment sat at PARTIALLY_PAID forever.
 *
 * Deliberately kept out of any "use server" module — every export from a
 * "use server" file is a public, unauthenticated POST endpoint, and this
 * records money and issues invoices. The auth-gated wrappers live in
 * actions/workshops/manage-reservation.js and actions/formations/manage-reservation.js.
 */

export const RESERVATION_KINDS = {
  WORKSHOP: {
    delegate: (client) => client.workshopReservation,
    invoiceSource: "WORKSHOP",
    label: "atelier",
    include: {
      // `type` is pulled in for the cash book alone: ateliers and
      // événements share this one reservation flow and are only told apart
      // by Activity.type — see seriesOf below.
      session: { include: { workshop: { select: { title: true, type: true } } } },
      customer: { include: { billingProfile: true } },
      payment: { include: { invoice: true } },
    },
    titleOf: (reservation) => reservation.session?.workshop?.title ?? "Atelier",
    seriesOf: (reservation) => seriesForActivityType(reservation.session?.workshop?.type),
    revalidatePath: "/dashboard/workshops/reservations",
  },
  FORMATION: {
    delegate: (client) => client.formationReservation,
    invoiceSource: "FORMATION",
    label: "formation",
    include: {
      session: { include: { formation: { select: { title: true } } } },
      customer: { include: { billingProfile: true } },
      payment: { include: { invoice: true } },
    },
    titleOf: (reservation) => reservation.session?.formation?.title ?? "Formation",
    seriesOf: () => PIECE_SERIES.FORMATION,
    revalidatePath: "/dashboard/formations/reservations",
  },
};

/**
 * Marks a CONFIRMED reservation COMPLETED, collecting and invoicing any
 * outstanding balance in the same transaction.
 *
 * @param {object} params
 * @param {"WORKSHOP"|"FORMATION"} params.kind
 * @param {string} params.reservationId
 * @param {"CASH"|"EXTERNAL_TERMINAL"} [params.method] Required only when a balance is due.
 * @param {boolean} [params.paymentConfirmed] Staff attestation that the money
 *   was physically received. Required whenever a balance is due.
 * @param {boolean} [params.terminalApproved] Staff attestation that the external terminal approved the charge.
 * @param {string|null} [params.terminalReference] External terminal receipt/reference.
 * @param {string} params.actorId
 * @param {{ role?: string, email?: string }} [params.actor] The acting user.
 *   When they are not a till cash operator (see isTillCashOperator), the
 *   balance is still collected and invoiced but the Transaction is recorded
 *   "off-till" — no cash-session link, no piece number, no attestation and no
 *   open-till requirement — so it shows in Opérations but never in the Livre
 *   de caisse or its X/Z reconciliation.
 */
export async function settleReservation({
  kind,
  reservationId,
  method,
  paymentConfirmed,
  terminalApproved,
  terminalReference,
  finalTotal,
  adjustmentReason,
  actorId,
  actor,
}) {
  const config = RESERVATION_KINDS[kind];
  if (!config) return { success: false, message: "Type de réservation inconnu." };
  if (!reservationId) return { success: false, message: "Identifiant de réservation manquant." };

  const reservation = await config.delegate(prisma).findUnique({
    where: { id: reservationId },
    include: config.include,
  });
  if (!reservation) return { success: false, message: "Réservation introuvable." };
  if (reservation.status !== "CONFIRMED") {
    return { success: false, message: `Seule une réservation confirmée peut être clôturée (statut actuel : ${reservation.status}).` };
  }
  // A future session hasn't happened yet — closing it out would let staff
  // collect a balance and issue an invoice for a service not yet rendered.
  // Mirrors completeAppointment's/markAppointmentNoShow's own guard.
  if (reservation.session?.startDate && new Date(reservation.session.startDate) > new Date()) {
    return { success: false, message: "Cette séance n'a pas encore eu lieu — impossible de clôturer la réservation." };
  }

  const payment = reservation.payment;
  if (!payment) {
    return { success: false, message: "Le paiement de cette réservation est introuvable." };
  }
  const priceAdjustment = resolveCounterPriceAdjustment({
    baseTotal: Number(payment.totalAmount ?? reservation.totalPrice),
    paidAmount: Number(payment.paidAmount ?? 0),
    finalTotal,
    reason: adjustmentReason,
  });
  if (!priceAdjustment.success) return priceAdjustment;

  const hasBalanceDue =
    priceAdjustment.amountDue > 0 &&
    (payment.status === "PARTIALLY_PAID" || (payment.status === "PAID" && priceAdjustment.changed));

  // Only Marie and OWNER/ADMIN put cash into the Livre de caisse. Anyone else
  // still closes the booking and still collects the balance, but the row is
  // recorded off-till (see the actor jsdoc above): no method choice, no
  // attestation, no open-till requirement — the "espèces / carte" popup is
  // hidden from them client-side too (SettleReservationDialog).
  const offTill = !isTillCashOperator(actor);
  const collectsAtTill = hasBalanceDue && !offTill;

  // A card payment is only accepted as EXTERNAL_TERMINAL, which carries the
    // terminal's approval and its receipt reference. Plain "CARD" used to be
    // accepted with no evidence at all: of 29 card collections in the dev
    // database, exactly one had a reference, so 28 could not be reconciled
    // against the terminal's end-of-day batch. Cash is at least tied to a
    // piece number and an open till session; a bare card row was tied to
    // nothing. The boutique POS (lib/validations/point-of-sale.js) and the
    // refund path (validateManualRefundConfirmation) already required this —
    // settlement was the one place that did not.
  if (collectsAtTill && !["CASH", "EXTERNAL_TERMINAL"].includes(method)) {
    return { success: false, message: "Mode de paiement requis pour encaisser le solde restant." };
  }
  if (collectsAtTill && method === "EXTERNAL_TERMINAL" && (terminalApproved !== true || !terminalReference?.trim())) {
    return { success: false, message: "Confirmez le paiement approuvé sur le terminal et indiquez la référence du ticket.", requiresPaymentConfirmation: true };
  }
  // The system cannot observe a physical cash handoff or a terminal's
  // "APPROUVÉ" screen. Without this attestation, staff could mark the
  // balance paid — and the system would treat it as real, invoiceable
  // revenue — before any money changed hands. Same guard as
  // completeAppointment and the POS terminal sale. Only asked of a till
  // operator: an off-till collection never enters the drawer total, so
  // there is nothing to reconcile it against.
  if (collectsAtTill && paymentConfirmed !== true) {
    return {
      success: false,
      message: "Confirmez avoir bien reçu le paiement avant de clôturer la réservation.",
      requiresPaymentConfirmation: true,
    };
  }
  // Cash with no till open used to be accepted and left unassigned
  // (cashSessionId: null), which is invisible from every Livre de caisse
  // forever — Transaction.pieceNumber is written once and never backfilled.
  // Fast-path check before the transaction; the authoritative one is inside
  // it, in case a session closes in the gap between the two.
  if (collectsAtTill && method === "CASH") {
    const openCashSessionGate = await ensureCashSessionOpen(prisma);
    if (!openCashSessionGate) {
      return {
        success: false,
        message: "Aucune session de caisse n'est ouverte. Ouvrez la caisse avant d'encaisser en espèces.",
        requiresCashSession: true,
      };
    }
  }

  let result;
  try {
    result = await prisma.$transaction(async (tx) => {
      // Atomic claim first, gated on CONFIRMED — a double-click or two staff
      // acting at once must not settle (and invoice) the same balance twice.
      const claim = await config.delegate(tx).updateMany({
        where: { id: reservationId, status: "CONFIRMED" },
        data: {
          status: "COMPLETED",
          ...(priceAdjustment.changed
            ? { totalPrice: priceAdjustment.finalTotal, balanceDue: 0 }
            : {}),
        },
      });
      if (claim.count === 0) return { claimed: false };

      if (!hasBalanceDue) {
        let adjustedPayment = payment;
        if (priceAdjustment.changed) {
          adjustedPayment = await tx.payment.update({
            where: { id: payment.id },
            data: {
              totalAmount: priceAdjustment.finalTotal,
              remainingAmount: 0,
              status: "PAID",
            },
          });
          await tx.auditLog.create({
            data: {
              actorId,
              action: AUDIT_ACTIONS.RESERVATION_PRICE_ADJUSTED,
              entityType: kind === "WORKSHOP" ? "WorkshopReservation" : "FormationReservation",
              entityId: reservationId,
              before: { totalAmount: priceAdjustment.previousTotal },
              after: { totalAmount: priceAdjustment.finalTotal },
              metadata: { reason: priceAdjustment.reason, paidAmountBeforeAdjustment: priceAdjustment.paidAmount },
            },
          });
        }
        const seats = reservation.seatsCount ?? 1;
        const serviceDescription = `${config.titleOf(reservation)} (${seats} place${seats > 1 ? "s" : ""})`;
        const { invoice, creditNote } = await resolveSettlementInvoice(tx, {
          existingInvoice: payment.invoice,
          priceChanged: priceAdjustment.changed,
          adjustmentReason: priceAdjustment.reason,
          shouldIssue: hasInvoiceableVatIdentity(reservation.customer),
          issue: (supersedesInvoiceId) =>
            issueInvoice(tx, {
              paymentId: adjustedPayment.id,
              source: config.invoiceSource,
              totalInclVat: Number(adjustedPayment.totalAmount),
              customer: buildInvoiceCustomer(reservation.customer),
              lines: buildServiceInvoiceLines({
                description: serviceDescription,
                totalAmount: Number(adjustedPayment.totalAmount),
                discountAmount: Number(adjustedPayment.discountAmount ?? 0),
                // Only on a replacement: the first invoice for a booking states
                // the price it was sold at, with nothing to explain.
                adjustmentAmount: supersedesInvoiceId
                  ? priceAdjustment.finalTotal - priceAdjustment.previousTotal
                  : 0,
                adjustmentReason: priceAdjustment.reason,
              }),
              supersedesInvoiceId,
            }),
        });
        return { claimed: true, invoice, creditNote, balance: 0 };
      }

      const balance = priceAdjustment.amountDue;
      const updatedPayment = await tx.payment.update({
        where: { id: payment.id },
        data: {
          totalAmount: priceAdjustment.finalTotal,
          paidAmount: priceAdjustment.finalTotal,
          remainingAmount: 0,
          status: "PAID",
        },
      });

      // Attach to whichever till session is open so the counter cash is
      // reconcilable at close (see lib/cash-sessions.js). Authoritative
      // check — the fast-path gate above already refused this request once
      // if no session was open, but a session can close in the gap between
      // that read and this write; re-checked here so the answer is never
      // stale by the time the row is actually created.
      // Only a till operator's CASH collection joins the drawer book; an
      // off-till collection (see the actor jsdoc) is deliberately detached —
      // no session lookup, no piece number, no open-till requirement.
      const useTill = !offTill && method === "CASH";
      const isTerminalCard = !offTill && method === "EXTERNAL_TERMINAL";
      const openCashSession = useTill
        ? await tx.cashSession.findFirst({ where: { closedAt: null }, select: { id: true } })
        : null;
      if (useTill && !openCashSession) throw new Error("RESERVATION_CASH_SESSION_CLOSED");
      // Cash-book line number, allocated only for the CASH rows that
      // actually enter the till total — see model Transaction.pieceNumber.
      const pieceNumber = useTill ? await allocatePieceNumber(tx, config.seriesOf(reservation)) : null;

      const collection = await tx.transaction.create({
        data: {
          paymentId: updatedPayment.id,
          amount: balance,
          // A card terminal collection records as CARD; a cash handover —
          // whether it joins the till or is taken off-till — records as CASH.
          method: isTerminalCard ? "CARD" : "CASH",
          transactionType: "FINAL_PAYMENT",
          paidAt: new Date(),
          cashSessionId: useTill ? openCashSession.id : null,
          pieceNumber,
          manualReference: isTerminalCard ? terminalReference.trim() : null,
        },
      });

      const seats = reservation.seatsCount ?? 1;
      const serviceDescription = `${config.titleOf(reservation)} (${seats} place${seats > 1 ? "s" : ""})`;
      // Same rule as the POS till (see hasInvoiceableVatIdentity): a
      // particulier never gets an invoice, and a company with a currently
      // VIES-valid VAT number always gets one created (never auto-sent —
      // see the ticket-only email below). No manual "request invoice"
      // checkbox exists anywhere in the app for this exact reason.
      const { invoice, creditNote } = await resolveSettlementInvoice(tx, {
        existingInvoice: payment.invoice,
        priceChanged: priceAdjustment.changed,
        adjustmentReason: priceAdjustment.reason,
        shouldIssue: hasInvoiceableVatIdentity(reservation.customer),
        issue: (supersedesInvoiceId) =>
          issueInvoice(tx, {
            paymentId: updatedPayment.id,
            source: config.invoiceSource,
            totalInclVat: Number(updatedPayment.totalAmount),
            customer: buildInvoiceCustomer(reservation.customer),
            lines: buildServiceInvoiceLines({
              description: serviceDescription,
              totalAmount: Number(updatedPayment.totalAmount),
              discountAmount: Number(updatedPayment.discountAmount ?? 0),
              // See the appointment path: a counter adjustment is named on the
              // document instead of being folded into a reconstructed price.
              adjustmentAmount: priceAdjustment.changed
                ? priceAdjustment.finalTotal - priceAdjustment.previousTotal
                : 0,
              adjustmentReason: priceAdjustment.reason,
            }),
            supersedesInvoiceId,
          }),
      });

      await tx.auditLog.create({
        data: {
          actorId,
          action: "reservation.settled",
          entityType: kind === "WORKSHOP" ? "WorkshopReservation" : "FormationReservation",
          entityId: reservationId,
          after: { status: "COMPLETED", balanceCollected: balance, paymentMethod: method },
          metadata: { invoiceNumber: invoice?.number ?? null },
        },
      });

      if (priceAdjustment.changed) {
        await tx.auditLog.create({
          data: {
            actorId,
            action: AUDIT_ACTIONS.RESERVATION_PRICE_ADJUSTED,
            entityType: kind === "WORKSHOP" ? "WorkshopReservation" : "FormationReservation",
            entityId: reservationId,
            before: { totalAmount: priceAdjustment.previousTotal },
            after: { totalAmount: priceAdjustment.finalTotal },
            metadata: { reason: priceAdjustment.reason, paidAmountBeforeAdjustment: priceAdjustment.paidAmount },
          },
        });
      }

      return { claimed: true, invoice, creditNote, balance, collection };
    });
  } catch (error) {
    if (error.message === "SELLER_LEGAL_DATA_INCOMPLETE") {
      return { success: false, message: "Identité légale du salon incomplète — complétez Réglages > Salon avant d'émettre des factures." };
    }
    if (error.message === "INVOICE_REPLACEMENT_VAT_EXPIRED") {
      return {
        success: false,
        message:
          "Le numéro de TVA de ce client n'est plus valide : sa facture ne peut pas être réémise au nouveau prix. Revalidez-le sur sa fiche, puis réessayez.",
      };
    }
    if (error.message === "BUYER_LEGAL_DATA_INCOMPLETE") {
      return { success: false, message: error.userMessage };
    }
    if (error.message === "RESERVATION_CASH_SESSION_CLOSED") {
      return {
        success: false,
        message: "La session de caisse vient d'être clôturée. Ouvrez-la à nouveau avant d'encaisser.",
        requiresCashSession: true,
      };
    }
    captureError(error, { area: "reservation-settlement", kind, reservationId });
    return { success: false, message: "Erreur lors de la clôture de la réservation." };
  }

  if (!result.claimed) {
    return { success: false, message: "Cette réservation vient de changer d'état. Actualisez la page." };
  }

  revalidatePath("/dashboard/operations");

  // No client-facing document or e-mail is sent for this balance collection
  // — only the legally-required Invoice, issued above inside the
  // transaction (and never auto-sent — Marie sends it manually from
  // Opérations). The cash-book UI still needs a refresh for a CASH
  // collection that actually entered the till (an off-till collection never
  // touches the Livre de caisse, so nothing there changed).
  if (result.balance > 0 && !offTill && method === "CASH") revalidateCaisseRoutes();

  return {
    success: true,
    message: result.balance > 0
      ? offTill
        ? `Réservation clôturée — solde de €${result.balance.toFixed(2)} enregistré et facturé.`
        : `Réservation clôturée — solde de €${result.balance.toFixed(2)} encaissé et facturé.`
      : "Réservation clôturée.",
    // Internal-only — stripped by the "use server" wrappers
    // (completeWorkshopReservation/completeFormationReservation) before
    // returning to the client. Exposed only so those wrappers can trigger
    // the permission-gated ticket send without this file (deliberately not
    // "use server") knowing anything about e-mail or permissions itself.
    paymentId: payment.id,
    balance: result.balance,
    transactionId: result.collection?.id ?? null,
  };
}

/**
 * Records that the customer never attended. Deliberately calls no Stripe and
 * issues no refund: a no-show is exactly the case where the deposit is kept,
 * so issuing a refund here would invert the policy. The kept deposit is now
 * final, non-refundable revenue though, so this does invoice it (mirrors
 * settleReservation's own issueInvoice call above) and marks the Payment
 * PAID. Mirrors markAppointmentNoShow's no-refund policy.
 */
export async function markReservationNoShow({ kind, reservationId, actorId }) {
  const config = RESERVATION_KINDS[kind];
  if (!config) return { success: false, message: "Type de réservation inconnu." };
  if (!reservationId) return { success: false, message: "Identifiant de réservation manquant." };

  const reservation = await config.delegate(prisma).findUnique({
    where: { id: reservationId },
    include: config.include,
  });
  if (!reservation) return { success: false, message: "Réservation introuvable." };
  // A future session hasn't happened yet — there's no "absence" to record
  // until the scheduled time has passed. Mirrors markAppointmentNoShow's
  // own guard.
  if (reservation.session?.startDate && new Date(reservation.session.startDate) > new Date()) {
    return { success: false, message: "Cette séance n'a pas encore eu lieu — impossible de marquer une absence." };
  }
  const payment = reservation.payment;

  try {
    const claimed = await prisma.$transaction(async (tx) => {
      const claim = await config.delegate(tx).updateMany({
        where: { id: reservationId, status: "CONFIRMED" },
        data: { status: "NO_SHOW" },
      });
      if (claim.count === 0) return false;

      // A no-show is exactly the case where the deposit is kept — that's now
      // final, non-refundable revenue, so the Payment always moves to PAID.
      // The invoice itself follows the same rule as a normally-settled
      // reservation (see settleReservation above): only a VIES-valid
      // company gets one; a particulier never does — but still gets marked
      // PAID, since withholding that status isn't what gates the invoice.
      if (payment && Number(payment.paidAmount) > 0.01 && !payment.invoice) {
        if (hasInvoiceableVatIdentity(reservation.customer)) {
          await issueInvoice(tx, {
            paymentId: payment.id,
            source: config.invoiceSource,
            totalInclVat: Number(payment.paidAmount),
            customer: buildInvoiceCustomer(reservation.customer),
            lines: buildServiceInvoiceLines({
              description: `Absence — acompte non remboursable — ${config.titleOf(reservation)}`,
              totalAmount: Number(payment.paidAmount),
            }),
          });
        }
        await tx.payment.update({ where: { id: payment.id }, data: { status: "PAID" } });
      }

      await tx.auditLog.create({
        data: {
          actorId,
          action: "reservation.no_show",
          entityType: kind === "WORKSHOP" ? "WorkshopReservation" : "FormationReservation",
          entityId: reservationId,
          after: { status: "NO_SHOW" },
        },
      });
      return true;
    });

    if (!claimed) {
      return { success: false, message: "Cette réservation ne peut plus être marquée absente (statut déjà modifié)." };
    }
    return { success: true, message: "Réservation marquée comme absence. Aucun remboursement n'a été émis." };
  } catch (error) {
    captureError(error, { area: "reservation-settlement", kind, reservationId, context: "no-show" });
    return { success: false, message: "Erreur lors du marquage de l'absence." };
  }
}
