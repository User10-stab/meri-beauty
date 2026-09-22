"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { isAdminRole } from "@/lib/authorization";
import { roundMoney } from "@/lib/tax-policy";
import { AUDIT_ACTIONS } from "@/lib/audit-log";
import { isBelgianVatNumber } from "@/lib/peppyrus";
import { issueInvoice, issueCreditNote } from "@/lib/invoicing";
import { buildStaffCustomer, issueRentInvoiceNow, pendingRentPaymentData, rentInvoiceInput } from "@/lib/staff-rent-payment";
import { buildPendingInvoicePreview } from "@/lib/invoices/invoice-preview";

/**
 * Staff rent on the Factures page.
 *
 * Since 2026-09-22 a rent is invoiced when it falls due — automatically
 * (lib/staff-monthly-billing.js, lib/staff-invoice.js), unpaid, with its
 * échéance — so the invoice can be sent before the staff member pays.
 *   - « Émettre la facture »: a rent recorded but not invoiced (the automatic
 *     issue was refused, or it predates this rule) gets its invoice now.
 *   - « Accepter »: the transfer arrived — records the money, the salon's
 *     income. On an invoiced rent that is all it does; on one not invoiced
 *     yet it also issues the invoice, so a paid rent never lacks one.
 *   - Note de crédit: corrects a rent invoice, before or after payment. Once
 *     paid, the refund transfer Marie made is recorded with it.
 */

const OPEN_PAYMENT_STATUSES = ["PENDING", "PARTIALLY_PAID"];

async function requireAdminSession() {
  const session = await auth();
  if (!session?.user || !isAdminRole(session.user.role)) return { error: "Non autorisé." };
  return { session };
}

const euro = (value) => new Intl.NumberFormat("fr-BE", { style: "currency", currency: "EUR" }).format(Number(value ?? 0));

function creditedTotal(invoice) {
  return (invoice.creditNotes ?? []).reduce((sum, note) => sum + Number(note.totalInclVat ?? 0), 0);
}

/** What DocumentDeliveryDialog needs to offer sending the new invoice. */
function serializeInvoice(invoice) {
  return {
    id: invoice.id,
    number: invoice.number,
    customerName: invoice.customerName,
    customerLegalName: invoice.customerLegalName,
    customerEmail: invoice.customerEmail,
    customerType: invoice.customerType,
    customerVatNumber: invoice.customerVatNumber,
    totalInclVat: Number(invoice.totalInclVat),
    emailSentAt: invoice.emailSentAt ?? null,
    peppyrusSentAt: invoice.peppyrusSentAt ?? null,
    peppolApplicable: invoice.customerType === "B2B" && isBelgianVatNumber(invoice.customerVatNumber),
  };
}

export async function listPendingStaffRent() {
  const guard = await requireAdminSession();
  if (guard.error) return { success: false, message: guard.error };

  let dueRents;
  let legacyInvoices;
  try {
    [dueRents, legacyInvoices] = await Promise.all([
      prisma.staffMonthlyInvoice.findMany({
        where: { status: "AWAITING_PAYMENT", invoiceId: null, payment: { is: { status: { in: OPEN_PAYMENT_STATUSES } } } },
        orderBy: [{ billingYear: "desc" }, { billingMonth: "desc" }, { generatedAt: "desc" }],
        take: 200,
        select: {
          id: true,
          generatedAt: true,
          dueDate: true,
          amount: true,
          lineDescription: true,
          staff: { select: { user: { select: { fullName: true, email: true } } } },
          payment: { select: { paidAmount: true } },
        },
      }),
      // Rent already invoiced (the normal case since 2026-09-22, and the
      // invoices issued before 2026-09-21): accepting records its payment.
      prisma.invoice.findMany({
        where: {
          source: "STAFF_CONTRACT",
          supersededAt: null,
          totalInclVat: { gt: 0 },
          OR: [{ paymentId: null }, { payment: { is: { status: { in: OPEN_PAYMENT_STATUSES } } } }],
        },
        orderBy: { issuedAt: "desc" },
        take: 200,
        select: {
          id: true,
          number: true,
          issuedAt: true,
          dueDate: true,
          customerName: true,
          customerLegalName: true,
          customerEmail: true,
          totalInclVat: true,
          lines: { select: { description: true }, take: 1 },
          creditNotes: { select: { totalInclVat: true } },
          payment: { select: { totalAmount: true, paidAmount: true } },
        },
      }),
    ]);
  } catch (error) {
    // Secondary to the invoice list on the same page: hide the panel only.
    console.error("[listPendingStaffRent]", error);
    return { success: false, message: "Impossible de charger les loyers en attente." };
  }

  const rows = [
    ...dueRents.map((rent) => ({
      kind: "RENT",
      rentId: rent.id,
      invoiceId: null,
      number: null,
      createdAt: rent.generatedAt,
      dueDate: rent.dueDate,
      staffName: rent.staff?.user?.fullName ?? "",
      staffEmail: rent.staff?.user?.email ?? null,
      period: rent.lineDescription ?? "",
      remainingAmount: roundMoney(Number(rent.amount ?? 0) - Number(rent.payment?.paidAmount ?? 0)),
    })),
    ...legacyInvoices
      // A fully credited rent invoice is owed by nobody.
      .filter((invoice) => creditedTotal(invoice) + 0.01 < Number(invoice.totalInclVat))
      .map((invoice) => ({
        kind: "LEGACY_INVOICE",
        rentId: null,
        invoiceId: invoice.id,
        number: invoice.number,
        createdAt: invoice.issuedAt,
        dueDate: invoice.dueDate,
        staffName: invoice.customerLegalName || invoice.customerName,
        staffEmail: invoice.customerEmail,
        period: invoice.lines[0]?.description ?? "",
        // A credit note on an unpaid rent lowers what its Payment expects.
        remainingAmount: invoice.payment
          ? roundMoney(Number(invoice.payment.totalAmount) - Number(invoice.payment.paidAmount))
          : roundMoney(Number(invoice.totalInclVat) - creditedTotal(invoice)),
      })),
  ];

  return {
    success: true,
    data: { rows, stats: { count: rows.length, remainingTotal: roundMoney(rows.reduce((sum, row) => sum + row.remainingAmount, 0)) } },
  };
}

/**
 * Marks a rent Payment fully paid and writes its TRANSFER, inside the
 * caller's transaction. Locked on the exact paidAmount just read, so two
 * tabs cannot both accept.
 */
async function recordRentTransfer(tx, paymentId, reference) {
  const payment = await tx.payment.findUnique({
    where: { id: paymentId },
    select: { status: true, totalAmount: true, paidAmount: true },
  });
  if (!payment || !OPEN_PAYMENT_STATUSES.includes(payment.status)) throw new Error("STAFF_RENT_ALREADY_PAID");

  const received = roundMoney(Number(payment.totalAmount) - Number(payment.paidAmount));
  if (!(received > 0)) throw new Error("STAFF_RENT_ALREADY_PAID");
  const paidAt = new Date();

  const claim = await tx.payment.updateMany({
    where: { id: paymentId, status: { in: OPEN_PAYMENT_STATUSES }, paidAmount: payment.paidAmount },
    data: { status: "PAID", paidAmount: Number(payment.totalAmount), remainingAmount: 0, paidAt },
  });
  if (claim.count === 0) throw new Error("STAFF_RENT_ALREADY_PAID");

  await tx.transaction.create({
    data: {
      paymentId,
      amount: received,
      method: "TRANSFER",
      transactionType: "FINAL_PAYMENT",
      paidAt,
      manualReference: reference || null,
      cashReceived: null,
      changeGiven: null,
      cashSessionId: null,
      pieceNumber: null,
    },
  });
  return { received, previousStatus: payment.status };
}

/** The rent due (AWAITING_PAYMENT) → transfer recorded + invoice issued, paid. */
async function acceptDueRent(session, rentId, reference) {
  const rent = await prisma.staffMonthlyInvoice.findUnique({
    where: { id: rentId },
    select: {
      id: true,
      status: true,
      invoiceId: true,
      paymentId: true,
      amount: true,
      lineDescription: true,
      dueDate: true,
      staff: { select: { id: true, vatNumber: true, user: true } },
    },
  });
  if (!rent || !rent.paymentId || !rent.staff?.user) throw new Error("STAFF_RENT_NOT_FOUND");
  if (rent.status !== "AWAITING_PAYMENT" || rent.invoiceId) throw new Error("STAFF_RENT_ALREADY_PAID");

  // Read outside the transaction (same helper the billing engine used).
  const customer = await buildStaffCustomer(rent.staff, rent.staff.user);
  const amount = Number(rent.amount);

  return prisma.$transaction(
    async (tx) => {
      // Claimed first: a second click finds the row already moved on.
      const claimed = await tx.staffMonthlyInvoice.updateMany({
        where: { id: rent.id, status: "AWAITING_PAYMENT", invoiceId: null },
        data: { status: "GENERATED" },
      });
      if (claimed.count === 0) throw new Error("STAFF_RENT_ALREADY_PAID");

      const { received, previousStatus } = await recordRentTransfer(tx, rent.paymentId, reference);

      // Paid → invoiced, in the same transaction: either both or neither.
      const invoice = await issueInvoice(
        tx,
        rentInvoiceInput({ paymentId: rent.paymentId, amount, lineDescription: rent.lineDescription, customer, dueDate: rent.dueDate })
      );
      await tx.staffMonthlyInvoice.update({ where: { id: rent.id }, data: { invoiceId: invoice.id } });

      await tx.auditLog.create({
        data: {
          actorId: session.user.id,
          actorRole: session.user.role,
          action: AUDIT_ACTIONS.STAFF_RENT_PAYMENT_ACCEPTED,
          entityType: "Invoice",
          entityId: invoice.id,
          before: { paymentStatus: previousStatus, invoice: null },
          after: { paymentStatus: "PAID", amount: received, method: "TRANSFER", reference: reference || null, number: invoice.number },
          metadata: { staffMonthlyInvoiceId: rent.id, paymentId: rent.paymentId, staffId: rent.staff.id },
        },
      });

      return { number: invoice.number, received, invoice };
    },
    { timeout: 20000, maxWait: 10000 }
  );
}

/** An invoiced rent: record its payment only — the invoice already exists. */
async function acceptInvoicedRent(session, invoiceId, reference) {
  return prisma.$transaction(
    async (tx) => {
      const invoice = await tx.invoice.findUnique({
        where: { id: invoiceId },
        select: {
          id: true,
          number: true,
          source: true,
          supersededAt: true,
          totalInclVat: true,
          paymentId: true,
          contractId: true,
          staffMonthlyInvoice: { select: { contractId: true } },
          creditNotes: { select: { totalInclVat: true } },
        },
      });
      if (!invoice || invoice.source !== "STAFF_CONTRACT") throw new Error("STAFF_RENT_NOT_FOUND");
      if (invoice.supersededAt || creditedTotal(invoice) + 0.01 >= Number(invoice.totalInclVat)) throw new Error("STAFF_RENT_CREDITED");

      let paymentId = invoice.paymentId;
      if (!paymentId) {
        const contractId = invoice.contractId ?? invoice.staffMonthlyInvoice?.contractId ?? null;
        if (!contractId) throw new Error("STAFF_RENT_NO_CONTRACT");
        const created = await tx.payment.create({
          data: pendingRentPaymentData(roundMoney(Number(invoice.totalInclVat) - creditedTotal(invoice)), contractId),
          select: { id: true },
        });
        // Claimed on paymentId still null, so a double click cannot attach two.
        const linked = await tx.invoice.updateMany({ where: { id: invoice.id, paymentId: null }, data: { paymentId: created.id } });
        if (linked.count === 0) throw new Error("STAFF_RENT_ALREADY_PAID");
        paymentId = created.id;
      }

      const { received, previousStatus } = await recordRentTransfer(tx, paymentId, reference);

      await tx.auditLog.create({
        data: {
          actorId: session.user.id,
          actorRole: session.user.role,
          action: AUDIT_ACTIONS.STAFF_RENT_PAYMENT_ACCEPTED,
          entityType: "Invoice",
          entityId: invoice.id,
          before: { paymentStatus: previousStatus },
          after: { paymentStatus: "PAID", amount: received, method: "TRANSFER", reference: reference || null },
          metadata: { invoiceNumber: invoice.number, paymentId },
        },
      });

      return { number: invoice.number, received, invoice: null };
    },
    { timeout: 20000, maxWait: 10000 }
  );
}

/**
 * « Accepter le paiement »: the rent transfer reached the account.
 * `{ invoiceId }` for an invoiced rent (records the money only), `{ rentId }`
 * for one not invoiced yet (also issues its invoice). The bank reference is
 * optional.
 */
export async function acceptStaffRentPayment(input) {
  const guard = await requireAdminSession();
  if (guard.error) return { success: false, message: guard.error };
  const { session } = guard;

  const rentId = typeof input?.rentId === "string" ? input.rentId.trim() : "";
  const invoiceId = typeof input?.invoiceId === "string" ? input.invoiceId.trim() : "";
  const reference = typeof input?.reference === "string" ? input.reference.trim().slice(0, 100) : "";
  if (!rentId && !invoiceId) return { success: false, message: "Loyer introuvable." };

  let outcome;
  try {
    outcome = rentId ? await acceptDueRent(session, rentId, reference) : await acceptInvoicedRent(session, invoiceId, reference);
  } catch (error) {
    const messages = {
      STAFF_RENT_NOT_FOUND: "Ce loyer est introuvable.",
      STAFF_RENT_CREDITED: "Cette facture a été créditée ou remplacée : plus rien n'est dû.",
      STAFF_RENT_ALREADY_PAID: "Ce loyer est déjà marqué comme payé.",
      STAFF_RENT_NO_CONTRACT: "Contrat de location introuvable pour cette facture.",
      SELLER_LEGAL_DATA_INCOMPLETE: "Paiement non accepté : les données légales du salon sont incomplètes (Paramètres), la facture ne peut pas être émise.",
    };
    if (error?.userMessage) return { success: false, message: `Paiement non accepté — ${error.userMessage}` };
    if (!messages[error?.message]) console.error("[acceptStaffRentPayment]", error);
    return { success: false, message: messages[error?.message] ?? "Impossible d'enregistrer le paiement." };
  }

  revalidatePath("/dashboard/factures");
  revalidatePath("/dashboard/livre-de-recettes");
  return {
    success: true,
    message: outcome.invoice
      ? `Paiement de ${euro(outcome.received)} accepté — facture ${outcome.number} émise.`
      : `Paiement de ${euro(outcome.received)} accepté — facture ${outcome.number} payée.`,
    data: { invoice: outcome.invoice ? serializeInvoice(outcome.invoice) : null },
  };
}

const RENT_ERROR_MESSAGES = {
  STAFF_RENT_NOT_FOUND: "Ce loyer est introuvable.",
  STAFF_RENT_ALREADY_INVOICED: "Ce loyer a déjà sa facture.",
  STAFF_RENT_CREDITED: "Cette facture est déjà entièrement créditée.",
  STAFF_RENT_CREDIT_AMOUNT: "Le montant de la note de crédit doit être supérieur à 0 et ne pas dépasser ce qui reste à créditer.",
  STAFF_RENT_CREDIT_REASON: "Indiquez le motif de la note de crédit (3 caractères au moins).",
  STAFF_RENT_REFUND_NOT_CONFIRMED: "Ce loyer est déjà payé : confirmez que le remboursement a bien été viré avant d'enregistrer la note de crédit.",
  STAFF_RENT_CHANGED: "Ce loyer vient d'être modifié ailleurs (paiement ou note de crédit). Rechargez la page.",
  SELLER_LEGAL_DATA_INCOMPLETE: "Les données légales du salon sont incomplètes (Paramètres > Salon) : la facture ne peut pas être émise.",
  CREDIT_NOTE_EXCEEDS_INVOICE: "La note de crédit dépasserait le montant de la facture.",
};

function rentErrorMessage(error, context) {
  if (error?.userMessage) return error.userMessage;
  if (!RENT_ERROR_MESSAGES[error?.message]) console.error(`[${context}]`, error);
  return RENT_ERROR_MESSAGES[error?.message] ?? "Opération impossible sur ce loyer.";
}

/**
 * What the send card shows for a rent not invoiced yet, BEFORE anything is
 * issued: the customer the invoice would carry (its e-mail, Peppol or not)
 * and the number it should get. Nothing is written, no number is taken —
 * « Émettre la facture » opens this card first, and the invoice is issued only
 * when the channels are chosen and confirmed (user's call, 2026-09-22).
 */
export async function getStaffRentIssueDraft(input) {
  const guard = await requireAdminSession();
  if (guard.error) return { success: false, message: guard.error };

  const rentId = typeof input?.rentId === "string" ? input.rentId.trim() : "";
  if (!rentId) return { success: false, message: RENT_ERROR_MESSAGES.STAFF_RENT_NOT_FOUND };

  const preview = await buildPendingInvoicePreview({ kind: "RENT", id: rentId });
  if (!preview.invoice) {
    return { success: false, message: preview.reason === "ALREADY_INVOICED" ? RENT_ERROR_MESSAGES.STAFF_RENT_ALREADY_INVOICED : preview.message };
  }
  return { success: true, data: { draft: { ...serializeInvoice({ ...preview.invoice, id: `draft-${rentId}` }), isDraft: true } } };
}

/**
 * « Émettre la facture » on a rent recorded without one — its automatic
 * issue was refused (missing data, since fixed), or it was recorded before
 * rents were invoiced up front. Issued unpaid, with its échéance. Called by
 * the send card once the channels are confirmed, right before sending.
 */
export async function issueStaffRentInvoice(input) {
  const guard = await requireAdminSession();
  if (guard.error) return { success: false, message: guard.error };

  const rentId = typeof input?.rentId === "string" ? input.rentId.trim() : "";
  if (!rentId) return { success: false, message: RENT_ERROR_MESSAGES.STAFF_RENT_NOT_FOUND };

  let invoice;
  try {
    invoice = await issueRentInvoiceNow(rentId, { actor: guard.session.user });
  } catch (error) {
    return { success: false, message: rentErrorMessage(error, "issueStaffRentInvoice") };
  }

  revalidatePath("/dashboard/factures");
  return {
    success: true,
    message: `Facture ${invoice.number} émise — ${euro(invoice.totalInclVat)}, à payer par virement.`,
    data: { invoice: serializeInvoice(invoice) },
  };
}

/**
 * Note de crédit on a rent invoice, for a mistake — before or after payment.
 *
 * Unpaid: the credit note lowers what the rent's Payment still expects (fully
 * credited, nothing is owed and the row leaves the list).
 *
 * Paid: the money has to go back. The app never refunds by itself — Marie
 * makes the transfer from the bank — so the credit note is recorded together
 * with that refund, once she confirms it was sent: a REFUND transfer linked to
 * the note, which the livre de recettes subtracts from « Loyers staff ».
 *
 * @param {{ invoiceId: string, amount?: number|null, reason: string,
 *           refundSent?: boolean, refundReference?: string }} input
 *   `amount` defaults to everything not yet credited.
 */
export async function creditStaffRentInvoice(input) {
  const guard = await requireAdminSession();
  if (guard.error) return { success: false, message: guard.error };
  const { session } = guard;

  const invoiceId = typeof input?.invoiceId === "string" ? input.invoiceId.trim() : "";
  const reason = typeof input?.reason === "string" ? input.reason.trim().slice(0, 300) : "";
  const refundReference = typeof input?.refundReference === "string" ? input.refundReference.trim().slice(0, 100) : "";
  const requested = input?.amount == null || input.amount === "" ? null : roundMoney(Number(input.amount));
  if (!invoiceId) return { success: false, message: RENT_ERROR_MESSAGES.STAFF_RENT_NOT_FOUND };
  if (reason.length < 3) return { success: false, message: RENT_ERROR_MESSAGES.STAFF_RENT_CREDIT_REASON };

  let outcome;
  try {
    outcome = await prisma.$transaction(
      async (tx) => {
        const invoice = await tx.invoice.findUnique({
          where: { id: invoiceId },
          select: {
            id: true,
            number: true,
            source: true,
            supersededAt: true,
            totalInclVat: true,
            paymentId: true,
            creditNotes: { select: { totalInclVat: true } },
            payment: {
              select: {
                id: true,
                status: true,
                totalAmount: true,
                paidAmount: true,
                transactions: { where: { isDeleted: false, transactionType: "REFUND" }, select: { amount: true } },
              },
            },
          },
        });
        if (!invoice || invoice.source !== "STAFF_CONTRACT" || invoice.supersededAt) throw new Error("STAFF_RENT_NOT_FOUND");

        const creditable = roundMoney(Number(invoice.totalInclVat) - creditedTotal(invoice));
        if (!(creditable > 0.001)) throw new Error("STAFF_RENT_CREDITED");
        const amount = requested ?? creditable;
        if (!(amount > 0) || amount > creditable + 0.001) throw new Error("STAFF_RENT_CREDIT_AMOUNT");

        const payment = invoice.payment;
        const paid = Number(payment?.paidAmount ?? 0) > 0.001;
        if (paid && input?.refundSent !== true) throw new Error("STAFF_RENT_REFUND_NOT_CONFIRMED");

        const creditNote = await issueCreditNote(tx, { invoiceId: invoice.id, reason, totalInclVat: amount });

        let refunded = null;
        if (payment && !paid) {
          // Claimed on what was just read, so a payment accepted at the same
          // moment is not silently reduced underneath it.
          const lowered = Math.max(0, roundMoney(Number(payment.totalAmount) - amount));
          const claim = await tx.payment.updateMany({
            where: { id: payment.id, status: payment.status, paidAmount: payment.paidAmount, totalAmount: payment.totalAmount },
            data: { totalAmount: lowered, remainingAmount: lowered },
          });
          if (claim.count === 0) throw new Error("STAFF_RENT_CHANGED");
        } else if (payment && paid) {
          const alreadyRefunded = payment.transactions.reduce((sum, row) => sum + Number(row.amount), 0);
          const refundedAfter = roundMoney(alreadyRefunded + amount);
          const claim = await tx.payment.updateMany({
            where: { id: payment.id, status: payment.status, paidAmount: payment.paidAmount },
            data: { status: refundedAfter + 0.001 >= Number(payment.paidAmount) ? "REFUNDED" : "PARTIALLY_REFUNDED" },
          });
          if (claim.count === 0) throw new Error("STAFF_RENT_CHANGED");
          await tx.transaction.create({
            data: {
              paymentId: payment.id,
              amount,
              method: "TRANSFER",
              transactionType: "REFUND",
              paidAt: new Date(),
              manualReference: refundReference || null,
              creditNoteId: creditNote.id,
              cashSessionId: null,
              pieceNumber: null,
            },
          });
          refunded = amount;
        }

        await tx.auditLog.create({
          data: {
            actorId: session.user.id,
            actorRole: session.user.role,
            action: AUDIT_ACTIONS.STAFF_RENT_CREDITED,
            entityType: "Invoice",
            entityId: invoice.id,
            before: { creditable, paymentStatus: payment?.status ?? null },
            after: { creditNote: creditNote.number, amount, refundedByTransfer: refunded, refundReference: refundReference || null },
            metadata: { invoiceNumber: invoice.number, paymentId: payment?.id ?? null, reason },
          },
        });

        return { creditNote, invoiceNumber: invoice.number, amount, refunded };
      },
      { timeout: 20000, maxWait: 10000 }
    );
  } catch (error) {
    return { success: false, message: rentErrorMessage(error, "creditStaffRentInvoice") };
  }

  revalidatePath("/dashboard/factures");
  revalidatePath("/dashboard/livre-de-recettes");
  return {
    success: true,
    message: outcome.refunded
      ? `Note de crédit ${outcome.creditNote.number} (${euro(outcome.amount)}) enregistrée avec le remboursement par virement.`
      : `Note de crédit ${outcome.creditNote.number} (${euro(outcome.amount)}) enregistrée sur la facture ${outcome.invoiceNumber}.`,
    data: { creditNoteNumber: outcome.creditNote.number },
  };
}
