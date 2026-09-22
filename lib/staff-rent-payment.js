import { prisma } from "@/lib/prisma";
import { issueInvoice } from "@/lib/invoicing";
import { formatUserAddress } from "@/lib/format-address";

/**
 * Staff rent (« location de poste »), paid by bank transfer.
 *
 * Since 2026-09-22 the invoice comes FIRST (user's call — it reverses the
 * payment-first rule of 2026-09-21): when a rent falls due
 * (lib/staff-monthly-billing.js on the anniversary date, lib/staff-invoice.js
 * for the first period of a new contract) the StaffMonthlyInvoice row and its
 * PENDING Payment are recorded, then the invoice is issued straight away,
 * carrying its échéance, so it can be sent before the staff member pays.
 * « Accepter » on the Factures page only records the money
 * (actions/invoices/staff-rent.js) — the salon's income.
 *
 * If issuing fails (missing buyer or salon data), the rent stays recorded
 * AWAITING_PAYMENT and the Factures page offers « Émettre la facture ».
 * A rent issued by mistake is corrected with a credit note, never deleted.
 *
 * The Payment's source is the rent contract (Payment.staffContractId — the
 * fifth source of the Payment_exactly_one_source CHECK). payeeStaffId stays
 * null: the rent is the salon's income.
 *
 * Not a "use server" module.
 */

/**
 * The buyer of a rent invoice. The staff member's own VAT number (on the
 * Staff row) stands in when her user account has none.
 */
/**
 * Rents recorded but not invoiced yet, in the order their invoices must take
 * numbers: oldest first (user's call, 2026-09-22 — the older rent gets the
 * lower number, then the next, with no reshuffling by click order).
 */
export const UNISSUED_RENT_WHERE = {
  status: "AWAITING_PAYMENT",
  invoiceId: null,
  payment: { is: { status: { in: ["PENDING", "PARTIALLY_PAID"] } } },
};
export const UNISSUED_RENT_ORDER = [{ generatedAt: "asc" }, { id: "asc" }];

/** The unissued rents older than `rent` ({ id, generatedAt }), oldest first. */
export function olderUnissuedRents(client, rent) {
  return client.staffMonthlyInvoice.findMany({
    where: {
      ...UNISSUED_RENT_WHERE,
      id: { not: rent.id },
      OR: [{ generatedAt: { lt: rent.generatedAt } }, { generatedAt: rent.generatedAt, id: { lt: rent.id } }],
    },
    orderBy: UNISSUED_RENT_ORDER,
    select: { id: true, lineDescription: true, staff: { select: { user: { select: { fullName: true } } } } },
  });
}

export async function buildStaffCustomer(staff, user) {
  let fullUser = user;
  try {
    const db = await prisma.user.findUnique({
      where: { id: user.id },
      include: { billingProfile: true },
    });
    if (db) fullUser = db;
  } catch {
    // Non-fatal — proceed with whatever we have
  }

  const address = formatUserAddress(fullUser) || fullUser?.vatValidationAddress || null;

  return {
    fullName: fullUser.fullName,
    email: fullUser.email,
    vatNumber: fullUser.vatNumber ?? staff.vatNumber ?? null,
    vatValidatedAt: fullUser.vatValidatedAt ?? null,
    address,
    isCompany: fullUser.isCompany ?? false,
    legalName: fullUser.billingProfile?.companyLegalName ?? null,
    companyRegistrationNo: fullUser.billingProfile?.companyRegistrationNo ?? null,
    billingContactName: fullUser.billingProfile?.billingContactName ?? null,
    purchaseOrderReference: fullUser.billingProfile?.purchaseOrderReference ?? null,
  };
}

/**
 * issueInvoice's input for a rent. Shared by the issuing paths and the
 * Factures preview, so the preview is exactly the invoice that is issued.
 * Only a rent invoice carries an échéance — no other invoice has one.
 */
export function rentInvoiceInput({ paymentId, amount, lineDescription, customer, dueDate = null }) {
  return {
    paymentId,
    source: "STAFF_CONTRACT",
    totalInclVat: amount,
    customer,
    dueDate: dueDate ?? null,
    lines: [{ description: lineDescription || "Location d'espace", quantity: 1, unitPrice: amount }],
  };
}

/** A rent Payment awaiting its transfer: nothing received yet. */
export function pendingRentPaymentData(amount, contractId) {
  return { staffContractId: contractId, totalAmount: amount, paidAmount: 0, remainingAmount: amount, paymentType: "ON_SITE", status: "PENDING" };
}

/**
 * Records a rent due, inside the caller's transaction: its pending Payment and
 * its StaffMonthlyInvoice row (AWAITING_PAYMENT). The row's
 * @@unique([staffId, billingYear, billingMonth]) still makes a second run for
 * the same period fail with P2002, as before. The invoice follows, in its own
 * transaction — see issueRentInvoiceNow.
 *
 * @param {object} tx - Prisma transaction client
 * @param {{ staffId: string, contractId: string, billingYear: number, billingMonth: number,
 *           amount: number, lineDescription: string, dueDate?: Date|null }} rent
 */
export async function createPendingRent(tx, { staffId, contractId, billingYear, billingMonth, amount, lineDescription, dueDate = null }) {
  const payment = await tx.payment.create({ data: pendingRentPaymentData(amount, contractId), select: { id: true } });
  return tx.staffMonthlyInvoice.create({
    data: {
      staffId,
      billingYear,
      billingMonth,
      contractId,
      status: "AWAITING_PAYMENT",
      paymentId: payment.id,
      amount,
      lineDescription,
      dueDate,
    },
  });
}

/**
 * Issues the invoice of a recorded rent, unpaid, with its échéance. The row
 * is claimed first (AWAITING_PAYMENT → GENERATED), so two runs — the billing
 * job and an admin's click — can never issue two invoices for one rent.
 *
 * Its own transaction: a refused invoice leaves the rent recorded and
 * waiting, and takes no number.
 *
 * @param {string} rentId - StaffMonthlyInvoice id
 * @param {{ actor?: { id: string, role: string } | null }} [options] - null for the billing job
 * @throws STAFF_RENT_NOT_FOUND | STAFF_RENT_ALREADY_INVOICED | whatever issueInvoice refuses
 */
export async function issueRentInvoiceNow(rentId, { actor = null } = {}) {
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
  if (rent.invoiceId || rent.status !== "AWAITING_PAYMENT") throw new Error("STAFF_RENT_ALREADY_INVOICED");

  // Read outside the transaction, like every other buyer lookup.
  const customer = await buildStaffCustomer(rent.staff, rent.staff.user);

  return prisma.$transaction(
    async (tx) => {
      const claimed = await tx.staffMonthlyInvoice.updateMany({
        where: { id: rent.id, status: "AWAITING_PAYMENT", invoiceId: null },
        data: { status: "GENERATED" },
      });
      if (claimed.count === 0) throw new Error("STAFF_RENT_ALREADY_INVOICED");

      const invoice = await issueInvoice(
        tx,
        rentInvoiceInput({
          paymentId: rent.paymentId,
          amount: Number(rent.amount),
          lineDescription: rent.lineDescription,
          customer,
          dueDate: rent.dueDate,
        })
      );
      await tx.staffMonthlyInvoice.update({ where: { id: rent.id }, data: { invoiceId: invoice.id } });

      await tx.auditLog.create({
        data: {
          actorId: actor?.id ?? null,
          actorRole: actor?.role ?? null,
          // AUDIT_ACTIONS.STAFF_RENT_INVOICE_ISSUED — spelled out: lib/audit-log.js
          // imports the auth stack, which the billing job has no business loading.
          action: "staff_rent.invoice_issued",
          entityType: "Invoice",
          entityId: invoice.id,
          after: { number: invoice.number, totalInclVat: Number(invoice.totalInclVat), dueDate: rent.dueDate, paymentStatus: "PENDING" },
          metadata: { staffMonthlyInvoiceId: rent.id, paymentId: rent.paymentId, staffId: rent.staff.id, automatic: !actor },
        },
      });

      return invoice;
    },
    { timeout: 20000, maxWait: 10000 }
  );
}
