"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { isAdminRole } from "@/lib/authorization";
import { roundMoney } from "@/lib/tax-policy";
import { AUDIT_ACTIONS } from "@/lib/audit-log";
import { issueInvoice } from "@/lib/invoicing";
import { isBelgianVatNumber } from "@/lib/peppyrus";
import { buildStaffCustomer } from "@/lib/staff-monthly-billing";
import { pendingRentPaymentData } from "@/lib/staff-rent-payment";

/**
 * Staff rent awaiting its transfer — the « Loyers staff en attente de
 * paiement » panel on the Factures page, which replaced the old
 * /dashboard/staff-invoices page.
 *
 * The rent due is recorded automatically (lib/staff-monthly-billing.js,
 * lib/staff-invoice.js) WITHOUT an invoice: a StaffMonthlyInvoice row
 * AWAITING_PAYMENT with a PENDING Payment (lib/staff-rent-payment.js).
 * « Accepter le paiement » records the TRANSFER and issues the invoice,
 * already paid, in one transaction — a staff member who never pays never gets
 * an invoice, and no number is ever used for one.
 *
 * Rent invoices issued before 2026-09-21 (invoice first, no payment) can
 * still be accepted: the payment is recorded against the existing invoice.
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
      // Before 2026-09-21 the invoice came first: accepting records its payment.
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
          payment: { select: { paidAmount: true } },
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
        remainingAmount: roundMoney(Number(invoice.totalInclVat) - Number(invoice.payment?.paidAmount ?? 0)),
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
      const invoice = await issueInvoice(tx, {
        paymentId: rent.paymentId,
        source: "STAFF_CONTRACT",
        totalInclVat: amount,
        customer,
        lines: [{ description: rent.lineDescription || "Location d'espace", quantity: 1, unitPrice: amount }],
      });
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

/** A rent invoice issued before this rule (invoice first): record its payment only. */
async function acceptLegacyInvoice(session, invoiceId, reference) {
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
          data: pendingRentPaymentData(Number(invoice.totalInclVat), contractId),
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
 * `{ rentId }` for a rent due (the invoice is issued now), `{ invoiceId }` for
 * a rent invoice issued before 2026-09-21. The bank reference is optional.
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
    outcome = rentId ? await acceptDueRent(session, rentId, reference) : await acceptLegacyInvoice(session, invoiceId, reference);
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
