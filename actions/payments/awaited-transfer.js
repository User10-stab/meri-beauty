"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { isTillCashOperator } from "@/lib/authorization";
import { roundMoney } from "@/lib/tax-policy";
import { isBelgianVatNumber } from "@/lib/peppyrus";
import { AUDIT_ACTIONS } from "@/lib/audit-log";
import { sendSettlementEmail } from "@/lib/payments/send-settlement-email";
import { sendReservationConfirmation } from "@/lib/reservations/send-reservation-confirmation";
import {
  AWAITED_TRANSFER_INCLUDE,
  acceptAwaitedTransferInTx,
  describeAwaitedTransfer,
} from "@/lib/payments/awaited-transfer";

/**
 * Bank transfers announced at the counter — a booking balance, a pickup
 * order or a séance sold on the spot, all closed out with « Virement ».
 * Nothing was received: the Payment is PENDING (or still PARTIALLY_PAID on a
 * deposit booking) and carries the amount expected.
 *
 * They are listed alongside the pending manual sales on Factures and under
 * the till, and accepted here once the money is on the account — which is
 * what records the TRANSFER and, for a VAT-registered buyer, issues the
 * invoice (lib/payments/awaited-transfer.js).
 *
 * Same people as the till's own money: the admins and Marie.
 */

async function requireOperator() {
  const session = await auth();
  if (!session?.user || !isTillCashOperator(session.user)) return { error: "Non autorisé." };
  return { session };
}

const euro = (value) => new Intl.NumberFormat("fr-BE", { style: "currency", currency: "EUR" }).format(Number(value ?? 0));

/**
 * The counter payments still waiting on their transfer. Manual sales are
 * excluded: they have richer rules of their own (partial settlements, VIES
 * re-check) and are listed by actions/invoices/manual-invoice.js, which
 * appends these rows to its own.
 */
export async function listAwaitedTransfers() {
  const guard = await requireOperator();
  if (guard.error) return { success: false, message: guard.error };

  let payments;
  try {
    payments = await prisma.payment.findMany({
      where: {
        isDeleted: false,
        awaitedTransferAmount: { not: null },
        status: { in: ["PENDING", "PARTIALLY_PAID"] },
        // An independent's sale is hers: the salon neither invoices nor
        // banks it (lib/payments/resolve-payee.js).
        payeeStaffId: null,
        NOT: { order: { is: { source: "MANUAL" } } },
      },
      // Payment has no createdAt column — ordering by one threw
      // PrismaClientValidationError on every call, so the panel silently
      // listed no counter transfers at all and they could never be accepted.
      // The id is a cuid, which sorts chronologically.
      orderBy: { id: "desc" },
      take: 200,
      include: AWAITED_TRANSFER_INCLUDE,
    });
  } catch (error) {
    // Secondary to the rest of the page: a failure hides the rows.
    console.error("[listAwaitedTransfers]", error);
    return { success: false, message: "Impossible de charger les virements attendus." };
  }

  const rows = payments
    .map((payment) => {
      const details = describeAwaitedTransfer(payment);
      if (!details) return null;
      const customer = details.customer;
      return {
        kind: "TRANSFER",
        paymentId: payment.id,
        source: details.kind,
        reference: details.label,
        createdAt: details.occurredAt,
        customerName: customer?.billingProfile?.companyLegalName || customer?.fullName || "",
        customerEmail: customer?.email ?? null,
        summary: details.summary,
        totalAmount: Number(payment.totalAmount),
        paidAmount: Number(payment.paidAmount),
        awaitedTransferAmount: Number(payment.awaitedTransferAmount),
        remainingAmount: roundMoney(Number(payment.totalAmount) - Number(payment.paidAmount)),
      };
    })
    .filter(Boolean);

  return { success: true, data: { rows, remainingTotal: roundMoney(rows.reduce((sum, row) => sum + row.awaitedTransferAmount, 0)) } };
}

/**
 * « Virement reçu » on one of those: records the transfer with its bank
 * reference, and — once the whole amount is in — the ticket and the invoice,
 * in the same transaction. Either all of it happens or none of it does.
 */
export async function acceptAwaitedTransfer(input) {
  const guard = await requireOperator();
  if (guard.error) return { success: false, message: guard.error };
  const { session } = guard;

  const paymentId = typeof input?.paymentId === "string" ? input.paymentId.trim() : "";
  const reference = typeof input?.reference === "string" ? input.reference.trim().slice(0, 100) : "";
  if (!paymentId) return { success: false, message: "Virement introuvable." };
  // The bank reference is optional: « Accepter » on the Factures page is one
  // tick and asks for nothing (user's call, 2026-09-21).

  let outcome;
  try {
    outcome = await prisma.$transaction(
      async (tx) => {
        const payment = await tx.payment.findUnique({ where: { id: paymentId }, include: AWAITED_TRANSFER_INCLUDE });
        if (!payment || payment.isDeleted) throw new Error("AWAITED_TRANSFER_NOT_FOUND");
        if (payment.awaitedTransferAmount == null) throw new Error("AWAITED_TRANSFER_NOT_AWAITED");
        if (payment.payeeStaffId) throw new Error("AWAITED_TRANSFER_INDEPENDENT");

        const recorded = await acceptAwaitedTransferInTx(tx, { payment, reference });

        await tx.auditLog.create({
          data: {
            actorId: session.user.id,
            actorRole: session.user.role,
            action: AUDIT_ACTIONS.AWAITED_TRANSFER_ACCEPTED,
            entityType: "Payment",
            entityId: payment.id,
            before: { paymentStatus: payment.status, paidAmount: Number(payment.paidAmount) },
            after: {
              paymentStatus: recorded.fullyPaid ? "PAID" : "PARTIALLY_PAID",
              amount: recorded.received,
              method: "TRANSFER",
              reference,
              ...(recorded.invoice ? { number: recorded.invoice.number } : {}),
            },
            metadata: { source: recorded.details.kind, label: recorded.details.label },
          },
        });

        return recorded;
      },
      { timeout: 20000, maxWait: 10000 }
    );
  } catch (error) {
    const messages = {
      AWAITED_TRANSFER_NOT_FOUND: "Ce paiement est introuvable.",
      AWAITED_TRANSFER_NOT_AWAITED: "Aucun virement n'est attendu sur ce paiement.",
      AWAITED_TRANSFER_ALREADY_PAID: "Ce virement a déjà été enregistré.",
      AWAITED_TRANSFER_INDEPENDENT: "Cette vente appartient à une indépendante : le salon ne l'encaisse pas.",
      AWAITED_TRANSFER_UNKNOWN_SOURCE: "Ce paiement n'est rattaché à aucune vente.",
      SELLER_LEGAL_DATA_INCOMPLETE:
        "Virement non enregistré : les données légales du salon sont incomplètes (Réglages > Salon), la facture ne peut pas être émise.",
    };
    if (error?.userMessage) return { success: false, message: `Virement non enregistré — ${error.userMessage}` };
    if (!messages[error?.message]) console.error("[acceptAwaitedTransfer]", error);
    return { success: false, message: messages[error?.message] ?? "Impossible d'enregistrer ce virement." };
  }

  // The client was told nothing when the transfer was announced — no ticket,
  // no confirmation. This is the moment it becomes true.
  //
  // A séance needs BOTH, and for different reasons. Its seat is confirmed on
  // a 50% acompte, and the confirmation carries the check-in QR the client
  // presents at the door — so that goes out as soon as the deposit is
  // accepted, whether or not the balance is settled. Sending only on full
  // payment left a real booking confirmed, its code minted, and the client
  // never told (21/09/2026).
  if (outcome.reservation) {
    sendReservationConfirmation(outcome.reservation.kind, outcome.reservation.row, {
      invoiceNote: outcome.invoice ? `Votre facture officielle (n°${outcome.invoice.number}) vous sera transmise séparément.` : "",
    }).catch((err) => console.error("[acceptAwaitedTransfer] seat confirmation failed:", err));
  }
  // The ticket is a receipt for money, so it still waits for the full amount.
  if (outcome.fullyPaid) {
    sendSettlementEmail(session.user, paymentId, { transactionId: outcome.transactionId }).catch((err) =>
      console.error("[acceptAwaitedTransfer] confirmation email failed:", err)
    );
  }

  revalidatePath("/dashboard/factures");
  revalidatePath("/dashboard/boutique/point-of-sale");
  revalidatePath("/dashboard/livre-de-recettes");
  revalidatePath("/dashboard/operations");
  return {
    success: true,
    // Same shape the other accept paths return, so the caller can offer to
    // send the invoice this transfer just issued without a second lookup.
    data: {
      invoice: outcome.invoice
        ? {
            id: outcome.invoice.id,
            number: outcome.invoice.number,
            customerName: outcome.invoice.customerName,
            customerLegalName: outcome.invoice.customerLegalName,
            customerEmail: outcome.invoice.customerEmail,
            customerType: outcome.invoice.customerType,
            customerVatNumber: outcome.invoice.customerVatNumber,
            totalInclVat: Number(outcome.invoice.totalInclVat),
            emailSentAt: outcome.invoice.emailSentAt ?? null,
            peppyrusSentAt: outcome.invoice.peppyrusSentAt ?? null,
            peppolApplicable: outcome.invoice.customerType === "B2B" && isBelgianVatNumber(outcome.invoice.customerVatNumber),
          }
        : null,
    },
    message: outcome.invoice
      ? `Virement de ${euro(outcome.received)} enregistré — facture ${outcome.invoice.number} émise.`
      : outcome.fullyPaid
      ? `Virement de ${euro(outcome.received)} enregistré.`
      : `Acompte de ${euro(outcome.received)} reçu par virement — le solde reste dû.`,
  };
}
