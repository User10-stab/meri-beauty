import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { sendEmail } from "@/lib/email";
import { issueInvoice, buildInvoiceCustomer, buildServiceInvoiceLines } from "@/lib/invoicing";
import { renderTicketPdf } from "@/lib/pdf/render";
import { collectionTicketFields } from "@/lib/cash-book/ticket-identity";
import { formatSalonAddress } from "@/lib/format-address";
import { hasInvoiceableVatIdentity, isPeppolMandatoryCustomer, resolveServiceVatPolicy } from "@/lib/tax-policy";
import { captureError } from "@/lib/monitoring";
import { allocatePieceNumber, PIECE_SERIES, seriesForActivityType } from "@/lib/cash-book/piece-number";
import { revalidateCaisseRoutes } from "@/lib/cash-book/revalidate-caisse";
import { resolveCounterPriceAdjustment } from "@/lib/payments/counter-price-adjustment";
import { AUDIT_ACTIONS } from "@/lib/audit-log";

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

  // A card payment is only accepted as EXTERNAL_TERMINAL, which carries the
    // terminal's approval and its receipt reference. Plain "CARD" used to be
    // accepted with no evidence at all: of 29 card collections in the dev
    // database, exactly one had a reference, so 28 could not be reconciled
    // against the terminal's end-of-day batch. Cash is at least tied to a
    // piece number and an open till session; a bare card row was tied to
    // nothing. The boutique POS (lib/validations/point-of-sale.js) and the
    // refund path (validateManualRefundConfirmation) already required this —
    // settlement was the one place that did not.
  if (hasBalanceDue && !["CASH", "EXTERNAL_TERMINAL"].includes(method)) {
    return { success: false, message: "Mode de paiement requis pour encaisser le solde restant." };
  }
  if (hasBalanceDue && method === "EXTERNAL_TERMINAL" && (terminalApproved !== true || !terminalReference?.trim())) {
    return { success: false, message: "Confirmez le paiement approuvé sur le terminal et indiquez la référence du ticket.", requiresPaymentConfirmation: true };
  }
  // The system cannot observe a physical cash handoff or a terminal's
  // "APPROUVÉ" screen. Without this attestation, staff could mark the
  // balance paid — and the system would treat it as real, invoiceable
  // revenue — before any money changed hands. Same guard as
  // completeAppointment and the POS terminal sale.
  if (hasBalanceDue && paymentConfirmed !== true) {
    return {
      success: false,
      message: "Confirmez avoir bien reçu le paiement avant de clôturer la réservation.",
      requiresPaymentConfirmation: true,
    };
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
        const invoice = payment.invoice ?? (
          hasInvoiceableVatIdentity(reservation.customer)
            ? await issueInvoice(tx, {
                paymentId: adjustedPayment.id,
                source: config.invoiceSource,
                totalInclVat: Number(adjustedPayment.totalAmount),
                customer: buildInvoiceCustomer(reservation.customer),
                lines: buildServiceInvoiceLines({
                  description: serviceDescription,
                  totalAmount: Number(adjustedPayment.totalAmount),
                  discountAmount: Number(adjustedPayment.discountAmount ?? 0),
                }),
              })
            : null
        );
        return { claimed: true, invoice, balance: 0 };
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
      // reconcilable at close (see lib/cash-sessions.js). Never blocks the
      // settlement if none is open — the row is simply left unassigned.
      const openCashSession =
        method === "CASH"
          ? await tx.cashSession.findFirst({ where: { closedAt: null }, select: { id: true } })
          : null;
      // Cash-book line number, allocated only for the CASH rows that
      // actually enter the till total — see model Transaction.pieceNumber.
      const pieceNumber = method === "CASH" ? await allocatePieceNumber(tx, config.seriesOf(reservation)) : null;

      const collection = await tx.transaction.create({
        data: {
          paymentId: updatedPayment.id,
          amount: balance,
          method: method === "CASH" ? "CASH" : "CARD",
          transactionType: "FINAL_PAYMENT",
          paidAt: new Date(),
          cashSessionId: openCashSession?.id ?? null,
          pieceNumber,
          manualReference: method === "EXTERNAL_TERMINAL" ? terminalReference.trim() : null,
        },
      });

      const seats = reservation.seatsCount ?? 1;
      const serviceDescription = `${config.titleOf(reservation)} (${seats} place${seats > 1 ? "s" : ""})`;
      // Same rule as the POS till (see hasInvoiceableVatIdentity): a
      // particulier never gets an invoice, and a company with a currently
      // VIES-valid VAT number always gets one created (never auto-sent —
      // see the ticket-only email below). No manual "request invoice"
      // checkbox exists anywhere in the app for this exact reason.
      const shouldCreateInvoice = hasInvoiceableVatIdentity(reservation.customer);
      const invoice = shouldCreateInvoice
        ? await issueInvoice(tx, {
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
          })
        : null;

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

      return { claimed: true, invoice, balance, collection };
    });
  } catch (error) {
    if (error.message === "SELLER_LEGAL_DATA_INCOMPLETE") {
      return { success: false, message: "Identité légale du salon incomplète — complétez Réglages > Salon avant d'émettre des factures." };
    }
    if (error.message === "BUYER_LEGAL_DATA_INCOMPLETE") {
      return { success: false, message: error.userMessage };
    }
    captureError(error, { area: "reservation-settlement", kind, reservationId });
    return { success: false, message: "Erreur lors de la clôture de la réservation." };
  }

  if (!result.claimed) {
    return { success: false, message: "Cette réservation vient de changer d'état. Actualisez la page." };
  }

  revalidatePath("/dashboard/operations");

  if (result.balance > 0) {
    try {
      // The invoice PDF itself is never auto-e-mailed here either, even when
      // one was created (VIES-valid company) — only a compact ticket goes out
      // automatically. Marie sends the real invoice manually from Opérations
      // afterward (Peppol for a Belgian VAT number, e-mail otherwise). Mirrors
      // actions/boutique/point-of-sale.js's own receipt-vs-invoice split.
      const seats = reservation.seatsCount ?? 1;
      const serviceDescription = `${config.titleOf(reservation)} (${seats} place${seats > 1 ? "s" : ""})`;
      const salon = await prisma.salon.findUnique({
        where: { id: "main-salon" },
        select: { legalName: true, vatNumber: true, addressLine1: true, addressLine2: true, postalCode: true, city: true, countryCode: true },
      });
      const { vatRate } = resolveServiceVatPolicy({ customer: reservation.customer });
      const receipt = collectionTicketFields(result.collection, result.invoice, vatRate);

      const ticketPdf = await renderTicketPdf({
        ...receipt,
        sellerName: salon?.legalName || "Meri Beauty",
        sellerAddress: formatSalonAddress(salon),
        sellerVatNumber: salon?.vatNumber ?? null,
        lines: [{ description: serviceDescription, quantity: 1, unitPrice: receipt.totalInclVat }],
      }).catch((error) => {
        captureError(error, { area: "reservation-settlement", kind, reservationId, context: "ticket-pdf" });
        return null;
      });

      const holdsInvoiceForPeppol = Boolean(result.invoice) && isPeppolMandatoryCustomer(reservation.customer);
      const pendingInvoiceNote = !result.invoice
        ? ""
        : holdsInvoiceForPeppol
        ? ` Votre facture officielle (n°${result.invoice.number}) vous sera transmise séparément via le réseau Peppol, conformément à la réglementation belge.`
        : ` Votre facture officielle (n°${result.invoice.number}) vous sera transmise séparément par e-mail.`;

      sendEmail({
        to: reservation.customer.email,
        subject: `Votre ticket — solde réglé – Meri Beauty`,
        text:
          `Bonjour ${reservation.customer.fullName},\n\n` +
          `Le solde de €${result.balance.toFixed(2)} pour votre ${config.label} « ${config.titleOf(reservation)} » a bien été encaissé. ` +
          `Votre ticket est joint à cet e-mail.${pendingInvoiceNote}\n\nL'équipe Meri Beauty`,
        html:
          `<p>Bonjour ${reservation.customer.fullName},</p>` +
          `<p>Le solde de <strong>€${result.balance.toFixed(2)}</strong> pour votre ${config.label} « ${config.titleOf(reservation)} » a bien été encaissé. ` +
          `Votre ticket est joint à cet e-mail.${pendingInvoiceNote ? ` ${pendingInvoiceNote.trim()}` : ""}</p><p>L'équipe Meri Beauty</p>`,
        ...(ticketPdf ? { attachments: [{ filename: `${receipt.ticketNumber}.pdf`, content: ticketPdf }] } : {}),
      }).catch((err) => console.error("[settleReservation] ticket email failed:", err));

      if (method === "CASH") revalidateCaisseRoutes();
    } catch (postCommitError) {
      // Everything above runs AFTER the transaction committed: the money is
      // recorded, the invoice is issued, the booking is closed. A ticket is a
      // courtesy on top of that, so nothing here may turn a settlement that
      // succeeded into one reported as failed.
      //
      // collectionTicketFields is the specific hazard — it throws rather than
      // returning null, and it sits outside renderTicketPdf's own .catch(). It
      // cannot throw today, because every precondition it checks is guaranteed
      // by the branch above. But a false failure here is not a cosmetic bug:
      // createCounterWalkInService deletes the appointment it just created
      // whenever this action reports failure, so a post-commit throw would ask
      // it to unwind a collection that really happened.
      console.error("[POST_COMMIT] settlement succeeded but the ticket step failed:", postCommitError);
    }
  }

  return {
    success: true,
    message: result.balance > 0
      ? `Réservation clôturée — solde de €${result.balance.toFixed(2)} encaissé et facturé.`
      : "Réservation clôturée.",
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
