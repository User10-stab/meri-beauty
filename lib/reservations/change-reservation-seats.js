import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { workshopSeatsChangedEmail, formationSeatsChangedEmail } from "@/lib/email-templates";
import { issueInvoice, supersedeInvoice, buildInvoiceCustomer, buildServiceInvoiceLines } from "@/lib/invoicing";
import { resolveServiceVatPolicy } from "@/lib/tax-policy";
import { OCCUPANCY_KINDS, sessionOccupancy } from "@/lib/reservations/session-occupancy";
import { resolveSeatChange, SEAT_CHANGE_ERRORS } from "@/lib/reservations/seat-change-pricing";
import { AUDIT_ACTIONS, writeAuditLog } from "@/lib/audit-log";

/**
 * Free counter seat-count change on an existing CONFIRMED workshop/formation
 * reservation — staff at the till adding or removing places for a customer
 * already booked, with no charge for the change itself.
 *
 * This is deliberately a different name and a different code path from
 * changeReservationSeats (actions/workshops/manage-reservation.js), which is
 * the customer's self-serve flow: a flat 10% Stripe fee, whose webhook keys
 * off the metadata string "seats_change_fee" and whose name is pinned by
 * tests/critical/activity-check-in-contracts.test.js. Reusing that name or
 * that flow here would collide with both.
 *
 * Deliberately kept out of any "use server" module, same reason as
 * settle-reservation.js: it records money and issues invoices, and every
 * export of a "use server" file is a public POST endpoint. The auth-gated
 * wrappers live in actions/workshops/manage-reservation.js
 * (changeWorkshopReservationSeatsFree) and
 * actions/formations/manage-reservation.js
 * (changeFormationReservationSeatsFree).
 */

const SEAT_CHANGE_KINDS = {
  WORKSHOP: {
    delegate: (client) => client.workshopReservation,
    sessionDelegate: (client) => client.workshopSession,
    reservationTable: "workshop_reservations",
    sessionTable: "workshop_sessions",
    occupancyKind: OCCUPANCY_KINDS.WORKSHOP,
    invoiceSource: "WORKSHOP",
    catalogueSelect: { select: { title: true, price: true } },
    catalogueOf: (session) => session.workshop,
    entityType: "WorkshopReservation",
    buildEmail: workshopSeatsChangedEmail,
  },
  FORMATION: {
    delegate: (client) => client.formationReservation,
    sessionDelegate: (client) => client.formationSession,
    reservationTable: "formation_reservations",
    sessionTable: "formation_sessions",
    occupancyKind: OCCUPANCY_KINDS.FORMATION,
    invoiceSource: "FORMATION",
    catalogueSelect: { select: { title: true, price: true } },
    catalogueOf: (session) => session.formation,
    entityType: "FormationReservation",
    buildEmail: formationSeatsChangedEmail,
  },
};

function money(value) {
  return Number(Number(value ?? 0).toFixed(2));
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

const ERROR_MESSAGES = {
  RESERVATION_NOT_FOUND: "Réservation introuvable.",
  RESERVATION_NOT_CONFIRMED: "Seule une réservation confirmée peut être modifiée.",
  PAYMENT_NOT_FOUND: "Aucun paiement fiable n'est lié à cette réservation.",
  PAYMENT_UNDER_REFUND: "Un remboursement est déjà en cours ou enregistré pour ce paiement.",
  LEGAL_DOCUMENT_EXISTS:
    "Cette réservation a déjà été corrigée par une note de crédit. Traitez-la manuellement avant de modifier le nombre de places.",
  INVOICE_REPLACEMENT_VAT_EXPIRED:
    "La validation TVA de ce client a expiré depuis l'émission de la facture initiale — impossible de réémettre une facture. Faites revalider le numéro TVA sur sa fiche, puis réessayez.",
  SELLER_LEGAL_DATA_INCOMPLETE:
    "Identité légale du salon incomplète — complétez Réglages > Salon avant de modifier une réservation facturée.",
  [SEAT_CHANGE_ERRORS.INVALID_SEATS]: "Le nombre de places doit être un entier positif.",
  [SEAT_CHANGE_ERRORS.SAME_SEATS]: "Cette réservation a déjà ce nombre de places.",
  [SEAT_CHANGE_ERRORS.SEATS_BELOW_CHECKED_IN]:
    "Ce nombre de places est inférieur au nombre de personnes déjà pointées.",
  [SEAT_CHANGE_ERRORS.SESSION_FULL]: "Pas assez de places disponibles sur cette séance.",
  [SEAT_CHANGE_ERRORS.OVERPAYMENT_REQUIRES_MANUAL_HANDLING]:
    "Le montant déjà encaissé dépasse le nouveau prix — traitez d'abord manuellement le trop-perçu.",
};

function seatChangeErrorMessage(code) {
  return ERROR_MESSAGES[code] ?? "Erreur lors de la modification du nombre de places.";
}

/**
 * @param {object} params
 * @param {"WORKSHOP"|"FORMATION"} params.kind
 * @param {string} params.reservationId
 * @param {number} params.newSeatsCount
 * @param {string} params.reason Required — shown on the audit log and, when
 *   an invoice must be superseded, on the credit note.
 * @param {string} params.actorId
 */
export async function changeReservationSeatsFree({ kind, reservationId, newSeatsCount, reason, actorId }) {
  const config = SEAT_CHANGE_KINDS[kind];
  if (!config) return { success: false, message: "Type de réservation inconnu." };
  if (!reservationId) return { success: false, message: "Identifiant de réservation manquant." };
  const normalizedReason = typeof reason === "string" ? reason.trim() : "";
  if (normalizedReason.length < 3 || normalizedReason.length > 500) {
    return { success: false, message: "Indiquez la raison du changement de nombre de places." };
  }

  let result;
  try {
    result = await prisma.$transaction(
      async (tx) => {
        // Lock order identical to changeReservationSession, to avoid
        // deadlocking against it: reservation, then session, then the
        // occupancy aggregate, then writes.
        await tx.$queryRaw(
          Prisma.sql`SELECT id FROM ${Prisma.raw(config.reservationTable)} WHERE id = ${reservationId} FOR UPDATE`
        );

        const reservation = await config.delegate(tx).findUnique({
          where: { id: reservationId },
          include: {
            session: {
              include: { [kind === "WORKSHOP" ? "workshop" : "formation"]: config.catalogueSelect },
            },
            // billingProfile is required by buildInvoiceCustomer whenever this
            // reservation's invoice has to be re-issued below.
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

        await tx.$queryRaw(
          Prisma.sql`SELECT id FROM ${Prisma.raw(config.sessionTable)} WHERE id = ${reservation.sessionId} FOR UPDATE`
        );

        const payment = reservation.payment;
        if (!payment) throw new Error("PAYMENT_NOT_FOUND");
        if (
          payment.transactions.length > 0 ||
          payment.refundOperations.length > 0 ||
          ["REFUNDED", "PARTIALLY_REFUNDED", "REFUND_PENDING", "REFUND_FAILED"].includes(payment.status)
        ) {
          throw new Error("PAYMENT_UNDER_REFUND");
        }
        if (payment.invoice?.creditNotes?.length) throw new Error("LEGAL_DOCUMENT_EXISTS");

        const occupiedByOthers = await sessionOccupancy(tx, {
          kind: config.occupancyKind,
          sessionId: reservation.sessionId,
          excludeReservationId: reservation.id,
        });

        const catalogue = config.catalogueOf(reservation.session);
        const { vatRate } = resolveServiceVatPolicy({ customer: reservation.customer });
        const discountAmount = money(payment.discountAmount ?? reservation.discountAmount);

        const pricing = resolveSeatChange({
          catalogueUnitPriceTtc: Number(catalogue.price),
          vatRate,
          currentSeats: reservation.seatsCount,
          newSeats: newSeatsCount,
          checkedInSeats: reservation.checkedInSeats,
          discountAmount,
          paidAmount: Number(payment.paidAmount),
          capacity: reservation.session.capacity,
          occupiedByOthers,
        });
        if (!pricing.success) throw new Error(pricing.code);

        await config.delegate(tx).update({
          where: { id: reservation.id },
          data: { seatsCount: pricing.newSeats, totalPrice: pricing.newTotal, balanceDue: pricing.newBalance },
        });
        await tx.payment.update({
          where: { id: payment.id },
          data: { totalAmount: pricing.newTotal, remainingAmount: pricing.newBalance, status: pricing.newStatus },
        });

        // Belgian VAT law forbids editing an already-issued invoice. This is
        // only reachable via a B2B customer who paid 100% upfront (the only
        // path that invoices at booking time — see
        // fulfill-workshop-reservation-payment.js /
        // fulfill-formation-reservation-payment.js). A deposit booking's
        // payment.invoice is null here; settleReservation issues the real
        // invoice at close from the updated Payment row, same as it always
        // does.
        let invoiceReplacement = null;
        if (payment.invoice) {
          const { creditNote } = await supersedeInvoice(tx, {
            invoice: payment.invoice,
            reason: `Changement du nombre de places — ${normalizedReason}`,
          });
          let newInvoice = null;
          // Only reissue once the new total is fully covered by what's
          // already paid. A seat increase typically leaves a balance due —
          // payment.invoice is now null (supersedeInvoice nulled its
          // paymentId), so settleReservation's own
          // `payment.invoice ?? issueInvoice(...)` fires naturally at close,
          // exactly like the session-transfer flow this mirrors.
          if (pricing.newBalance <= 0.01) {
            try {
              newInvoice = await issueInvoice(tx, {
                paymentId: payment.id,
                source: config.invoiceSource,
                totalInclVat: pricing.newTotal,
                customer: buildInvoiceCustomer(reservation.customer),
                lines: buildServiceInvoiceLines({
                  description: `${catalogue.title} (${pricing.newSeats} place${pricing.newSeats > 1 ? "s" : ""})`,
                  totalAmount: pricing.newTotal,
                  discountAmount,
                }),
                supersedesInvoiceId: payment.invoice.id,
              });
            } catch (reissueError) {
              if (reissueError.message === "B2C_INVOICE_NOT_ALLOWED") {
                throw new Error("INVOICE_REPLACEMENT_VAT_EXPIRED");
              }
              throw reissueError;
            }
          }
          invoiceReplacement = {
            previousInvoice: {
              id: payment.invoice.id,
              number: payment.invoice.number,
              customerType: "B2B",
              customerVatNumber: reservation.customer.vatNumber,
            },
            creditNote: { id: creditNote.id, number: creditNote.number },
            newInvoice: newInvoice
              ? { id: newInvoice.id, number: newInvoice.number, customerType: "B2B", customerVatNumber: reservation.customer.vatNumber }
              : null,
          };
        }

        await writeAuditLog(tx, {
          action: AUDIT_ACTIONS.RESERVATION_SEATS_CHANGED,
          entityType: config.entityType,
          entityId: reservation.id,
          actor: { id: actorId },
          before: { seatsCount: reservation.seatsCount, totalPrice: money(reservation.totalPrice), balanceDue: money(reservation.balanceDue) },
          after: { seatsCount: pricing.newSeats, totalPrice: pricing.newTotal, balanceDue: pricing.newBalance },
          metadata: {
            reason: normalizedReason,
            unitPrice: pricing.unitPrice,
            discountAmount,
            paidAmount: pricing.paidAmount,
            occupiedByOthers,
            stripeInvolved: false,
            ...(invoiceReplacement ? { invoiceReplacement } : {}),
          },
        });

        return {
          reservationId: reservation.id,
          code: reservation.checkInCode,
          activityTitle: catalogue.title,
          sessionStartDate: reservation.session.startDate,
          customer: { fullName: reservation.customer.fullName, email: reservation.customer.email },
          previousSeats: pricing.previousSeats,
          newSeats: pricing.newSeats,
          checkedInSeats: reservation.checkedInSeats,
          totalPrice: pricing.newTotal,
          paidAmount: pricing.paidAmount,
          balanceDue: pricing.newBalance,
          invoiceReplacement,
        };
      },
      { timeout: 15_000 } // Prisma's 5s default is too tight once an invoiced
      // reservation's seats change: superseding adds a credit note and a
      // replacement invoice, each allocating a gapless number under its own
      // query, on top of the row locks and the occupancy aggregate above.
    );
  } catch (error) {
    if (error.message === "BUYER_LEGAL_DATA_INCOMPLETE") {
      return { success: false, message: error.userMessage || seatChangeErrorMessage(error.message) };
    }
    const knownMessage = seatChangeErrorMessage(error?.message);
    if (knownMessage !== "Erreur lors de la modification du nombre de places.") {
      return { success: false, message: knownMessage };
    }
    console.error("[changeReservationSeatsFree]", error);
    return { success: false, message: knownMessage };
  }

  const emailResult = await sendEmail({
    to: result.customer.email,
    ...config.buildEmail({
      customerName: result.customer.fullName,
      activityTitle: result.activityTitle,
      sessionDate: formatSessionDate(result.sessionStartDate),
      previousSeats: result.previousSeats,
      newSeats: result.newSeats,
      totalPrice: result.totalPrice,
      paidAmount: result.paidAmount,
      balanceDue: result.balanceDue,
    }),
  }).catch((error) => {
    console.error("[changeReservationSeatsFree] confirmation email failed:", error);
    return { success: false };
  });

  // The domain-specific reservations list is revalidated by the auth-gated
  // wrapper (changeWorkshopReservationSeatsFree / changeFormationReservationSeatsFree),
  // same split as settleReservation / completeWorkshopReservation.
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
      ? `Nombre de places modifié sans frais et e-mail de confirmation envoyé.${documentNote}`
      : `Nombre de places modifié sans frais, mais l'e-mail n'a pas pu être envoyé.${documentNote}`,
    emailSent: Boolean(emailResult?.success),
    data: {
      reservationId: result.reservationId,
      code: result.code,
      seatsCount: result.newSeats,
      checkedInSeats: result.checkedInSeats,
      totalPrice: result.totalPrice,
      paidAmount: result.paidAmount,
      balanceDue: result.balanceDue,
      invoiceReplacement,
    },
  };
}
