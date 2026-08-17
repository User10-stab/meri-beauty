import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { issueInvoice, buildInvoiceCustomer, buildServiceInvoiceLines } from "@/lib/invoicing";
import { renderInvoicePdf } from "@/lib/pdf/render";
import { captureError } from "@/lib/monitoring";

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
      session: { include: { workshop: { select: { title: true } } } },
      customer: { include: { billingProfile: true } },
      payment: { include: { invoice: true } },
    },
    titleOf: (reservation) => reservation.session?.workshop?.title ?? "Atelier",
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
 * @param {"CASH"|"CARD"} [params.method] Required only when a balance is due.
 * @param {boolean} [params.paymentConfirmed] Staff attestation that the money
 *   was physically received. Required whenever a balance is due.
 * @param {string} params.actorId
 */
export async function settleReservation({ kind, reservationId, method, paymentConfirmed, actorId }) {
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

  const payment = reservation.payment;
  const hasBalanceDue =
    Boolean(payment) && payment.status === "PARTIALLY_PAID" && Number(payment.remainingAmount) > 0;

  if (hasBalanceDue && !["CASH", "CARD"].includes(method)) {
    return { success: false, message: "Mode de paiement requis pour encaisser le solde restant." };
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
        data: { status: "COMPLETED" },
      });
      if (claim.count === 0) return { claimed: false };

      if (!hasBalanceDue) return { claimed: true, invoice: null, balance: 0 };

      const balance = Number(payment.remainingAmount);
      const updatedPayment = await tx.payment.update({
        where: { id: payment.id },
        data: { paidAmount: payment.totalAmount, remainingAmount: 0, status: "PAID" },
      });

      // Attach to whichever till session is open so the counter cash is
      // reconcilable at close (see lib/cash-sessions.js). Never blocks the
      // settlement if none is open — the row is simply left unassigned.
      const openCashSession =
        method === "CASH"
          ? await tx.cashSession.findFirst({ where: { closedAt: null }, select: { id: true } })
          : null;

      await tx.transaction.create({
        data: {
          paymentId: updatedPayment.id,
          amount: balance,
          method,
          transactionType: "FINAL_PAYMENT",
          paidAt: new Date(),
          cashSessionId: openCashSession?.id ?? null,
        },
      });

      const seats = reservation.seatsCount ?? 1;
      const invoice = await issueInvoice(tx, {
        paymentId: updatedPayment.id,
        source: config.invoiceSource,
        totalInclVat: Number(updatedPayment.totalAmount),
        customer: buildInvoiceCustomer(reservation.customer),
        lines: buildServiceInvoiceLines({
          description: `${config.titleOf(reservation)} (${seats} place${seats > 1 ? "s" : ""})`,
          totalAmount: Number(updatedPayment.totalAmount),
          discountAmount: Number(updatedPayment.discountAmount ?? 0),
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

      return { claimed: true, invoice, balance };
    });
  } catch (error) {
    if (error.message === "SELLER_LEGAL_DATA_INCOMPLETE") {
      return { success: false, message: "Identité légale du salon incomplète — complétez Réglages > Salon avant d'émettre des factures." };
    }
    captureError(error, { area: "reservation-settlement", kind, reservationId });
    return { success: false, message: "Erreur lors de la clôture de la réservation." };
  }

  if (!result.claimed) {
    return { success: false, message: "Cette réservation vient de changer d'état. Actualisez la page." };
  }

  if (result.invoice) {
    const invoicePdf = await renderInvoicePdf(result.invoice).catch((error) => {
      captureError(error, { area: "reservation-settlement", kind, reservationId, context: "invoice-pdf" });
      return null;
    });

    sendEmail({
      to: reservation.customer.email,
      subject: `Facture — solde réglé – Meri Beauty`,
      text:
        `Bonjour ${reservation.customer.fullName},\n\n` +
        `Le solde de €${result.balance.toFixed(2)} pour votre ${config.label} « ${config.titleOf(reservation)} » a bien été encaissé. ` +
        `Vous trouverez votre facture en pièce jointe.\n\nL'équipe Meri Beauty`,
      html:
        `<p>Bonjour ${reservation.customer.fullName},</p>` +
        `<p>Le solde de <strong>€${result.balance.toFixed(2)}</strong> pour votre ${config.label} « ${config.titleOf(reservation)} » a bien été encaissé. ` +
        `Vous trouverez votre facture en pièce jointe.</p><p>L'équipe Meri Beauty</p>`,
      ...(invoicePdf ? { attachments: [{ filename: `facture-${result.invoice.number}.pdf`, content: invoicePdf }] } : {}),
    }).catch((err) => console.error("[settleReservation] invoice email failed:", err));
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
  const payment = reservation?.payment;

  try {
    const claimed = await prisma.$transaction(async (tx) => {
      const claim = await config.delegate(tx).updateMany({
        where: { id: reservationId, status: "CONFIRMED" },
        data: { status: "NO_SHOW" },
      });
      if (claim.count === 0) return false;

      // A no-show is exactly the case where the deposit is kept — that's now
      // final, non-refundable revenue, so it needs the same legally-required
      // invoice as a normally-settled reservation (see this file's own
      // issueInvoice call above in settleReservation).
      if (payment && Number(payment.paidAmount) > 0.01 && !payment.invoice) {
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
