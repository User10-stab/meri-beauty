import { beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Staff rent (« location de poste »), since 2026-09-21:
 *   - the « Facturation mensuelle » page (/dashboard/staff-invoices) is gone;
 *   - a rent falling due is recorded WITHOUT an invoice — a StaffMonthlyInvoice
 *     row AWAITING_PAYMENT with a PENDING transfer Payment;
 *   - « Accepter le paiement » (Factures page) records the transfer and issues
 *     the invoice, paid, in one transaction. A staff member who never pays
 *     never gets an invoice, and no number is used.
 */

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  prisma: {
    invoice: { findMany: vi.fn() },
    staffMonthlyInvoice: { findMany: vi.fn(), findUnique: vi.fn() },
    $transaction: vi.fn(),
  },
  tx: null,
  issueInvoice: vi.fn(),
  buildStaffCustomer: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/invoicing", () => ({ issueInvoice: mocks.issueInvoice, buildRentalDescription: () => "Location d'espace — octobre 2026" }));
vi.mock("@/lib/staff-monthly-billing", () => ({ buildStaffCustomer: mocks.buildStaffCustomer }));
vi.mock("@/lib/peppyrus", () => ({ isBelgianVatNumber: (vat) => String(vat ?? "").startsWith("BE") }));

import { createPendingRent, pendingRentPaymentData } from "@/lib/staff-rent-payment";
import { acceptStaffRentPayment, listPendingStaffRent } from "@/actions/invoices/staff-rent";
import { categoryForPayment } from "@/lib/payments/payment-category";
import { creditNoteEligibility } from "@/lib/invoices/list-filters";
import { RECETTES_CATEGORIES } from "@/lib/livre-de-recettes/filters";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8").replace(/\r\n/g, "\n");

const ADMIN = { id: "u_admin", role: "ADMIN", email: "admin@meribeauty.com" };
const INDEPENDENT = { id: "u_julie", role: "STAFF", email: "julie@example.com" };

const DUE_RENT = {
  id: "smi_1",
  status: "AWAITING_PAYMENT",
  invoiceId: null,
  paymentId: "p_rent",
  amount: "500.00",
  lineDescription: "Location d'espace — octobre 2026",
  staff: { id: "s_lyly", vatNumber: "BE0123456789", user: { id: "u_lyly", fullName: "Lyly", email: "lyly@example.com" } },
};

const ISSUED = {
  id: "inv_new",
  number: "F-2026-000031",
  customerName: "Lyly",
  customerLegalName: "Lyly",
  customerEmail: "lyly@example.com",
  customerType: "B2B",
  customerVatNumber: "BE0123456789",
  totalInclVat: "500.00",
};

const LEGACY_INVOICE = {
  id: "inv_old",
  number: "F-2026-000010",
  source: "STAFF_CONTRACT",
  supersededAt: null,
  totalInclVat: "100.00",
  paymentId: null,
  contractId: "c_old",
  staffMonthlyInvoice: null,
  creditNotes: [],
};

function makeTx({
  invoice = LEGACY_INVOICE,
  payment = { status: "PENDING", totalAmount: "500.00", paidAmount: "0.00" },
  rowClaim = 1,
  claimCount = 1,
  linkCount = 1,
} = {}) {
  return {
    invoice: {
      findUnique: vi.fn().mockResolvedValue(invoice),
      updateMany: vi.fn().mockResolvedValue({ count: linkCount }),
    },
    staffMonthlyInvoice: {
      create: vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: "smi_new", ...data })),
      updateMany: vi.fn().mockResolvedValue({ count: rowClaim }),
      update: vi.fn().mockResolvedValue({}),
    },
    payment: {
      create: vi.fn().mockResolvedValue({ id: "p_new" }),
      findUnique: vi.fn().mockResolvedValue(payment),
      updateMany: vi.fn().mockResolvedValue({ count: claimCount }),
    },
    transaction: { create: vi.fn() },
    auditLog: { create: vi.fn() },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ user: ADMIN });
  mocks.tx = makeTx();
  mocks.prisma.$transaction.mockImplementation((fn) => fn(mocks.tx));
  mocks.prisma.staffMonthlyInvoice.findUnique.mockResolvedValue(DUE_RENT);
  mocks.buildStaffCustomer.mockResolvedValue({ fullName: "Lyly", email: "lyly@example.com", vatNumber: "BE0123456789" });
  mocks.issueInvoice.mockResolvedValue(ISSUED);
});

describe("a rent falling due is recorded without an invoice", () => {
  it("a PENDING transfer payment sourced on the contract, and the period AWAITING_PAYMENT — no invoice, no number", async () => {
    const tx = makeTx();
    const row = await createPendingRent(tx, {
      staffId: "s_lyly",
      contractId: "c_lyly",
      billingYear: 2026,
      billingMonth: 10,
      amount: 500,
      lineDescription: "Location d'espace — octobre 2026",
      dueDate: new Date("2026-10-08"),
    });
    expect(tx.payment.create.mock.calls[0][0].data).toEqual({
      staffContractId: "c_lyly",
      totalAmount: 500,
      paidAmount: 0,
      remainingAmount: 500,
      paymentType: "ON_SITE",
      status: "PENDING",
    });
    // Salon income: no payee.
    expect(tx.payment.create.mock.calls[0][0].data).not.toHaveProperty("payeeStaffId");
    expect(row).toMatchObject({
      staffId: "s_lyly",
      billingYear: 2026,
      billingMonth: 10,
      contractId: "c_lyly",
      status: "AWAITING_PAYMENT",
      paymentId: "p_new",
      amount: 500,
    });
    expect(row).not.toHaveProperty("invoiceId");
    expect(mocks.issueInvoice).not.toHaveBeenCalled();
    expect(tx.transaction.create).not.toHaveBeenCalled();
  });

  it("both rent paths record it and neither issues an invoice any more", () => {
    for (const file of ["lib/staff-monthly-billing.js", "lib/staff-invoice.js"]) {
      const code = source(file);
      expect(code).toContain("createPendingRent(tx, {");
      expect(code).not.toMatch(/await issueInvoice\(/);
    }
    // A 0 € contract owes nothing.
    expect(source("lib/staff-invoice.js")).toContain("amount > 0");
    expect(pendingRentPaymentData(300, "c_rose")).toMatchObject({ staffContractId: "c_rose", status: "PENDING" });
  });
});

describe("« Accepter le paiement » on a rent due", () => {
  it("admins only", async () => {
    mocks.auth.mockResolvedValue({ user: INDEPENDENT });
    expect((await acceptStaffRentPayment({ rentId: "smi_1" })).success).toBe(false);
    expect((await listPendingStaffRent()).success).toBe(false);
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("records the TRANSFER, then issues the invoice — paid — in the same transaction, and offers to send it", async () => {
    mocks.tx = makeTx();
    const result = await acceptStaffRentPayment({ rentId: "smi_1", reference: " +++123/4567/89012+++ " });
    expect(result).toMatchObject({
      success: true,
      message: expect.stringContaining("F-2026-000031 émise"),
      data: { invoice: { id: "inv_new", number: "F-2026-000031", peppolApplicable: true } },
    });
    expect(mocks.tx.staffMonthlyInvoice.updateMany).toHaveBeenCalledWith({
      where: { id: "smi_1", status: "AWAITING_PAYMENT", invoiceId: null },
      data: { status: "GENERATED" },
    });
    expect(mocks.tx.payment.updateMany.mock.calls[0][0]).toMatchObject({
      where: { id: "p_rent", status: { in: ["PENDING", "PARTIALLY_PAID"] }, paidAmount: "0.00" },
      data: { status: "PAID", paidAmount: 500, remainingAmount: 0 },
    });
    expect(mocks.tx.transaction.create.mock.calls[0][0].data).toMatchObject({
      paymentId: "p_rent",
      amount: 500,
      method: "TRANSFER",
      transactionType: "FINAL_PAYMENT",
      manualReference: "+++123/4567/89012+++",
      cashSessionId: null,
    });
    expect(mocks.issueInvoice).toHaveBeenCalledWith(mocks.tx, {
      paymentId: "p_rent",
      source: "STAFF_CONTRACT",
      totalInclVat: 500,
      customer: expect.objectContaining({ fullName: "Lyly", vatNumber: "BE0123456789" }),
      lines: [{ description: "Location d'espace — octobre 2026", quantity: 1, unitPrice: 500 }],
    });
    expect(mocks.tx.staffMonthlyInvoice.update).toHaveBeenCalledWith({ where: { id: "smi_1" }, data: { invoiceId: "inv_new" } });
    expect(mocks.tx.auditLog.create.mock.calls[0][0].data).toMatchObject({ action: "staff_rent.payment_accepted", entityId: "inv_new" });
  });

  it("the reference is optional", async () => {
    await acceptStaffRentPayment({ rentId: "smi_1" });
    expect(mocks.tx.transaction.create.mock.calls[0][0].data.manualReference).toBeNull();
  });

  it("if the invoice cannot be issued, the payment is not accepted either — the message says why", async () => {
    mocks.issueInvoice.mockRejectedValue(new Error("SELLER_LEGAL_DATA_INCOMPLETE"));
    const result = await acceptStaffRentPayment({ rentId: "smi_1" });
    expect(result).toMatchObject({ success: false, message: expect.stringContaining("données légales du salon") });
    // Same transaction — the mocked tx can't roll back, but nothing ran after the failure.
    expect(mocks.tx.staffMonthlyInvoice.update).not.toHaveBeenCalled();
    expect(mocks.tx.auditLog.create).not.toHaveBeenCalled();
  });

  it("a second click (or an already accepted rent) is refused — never a second invoice", async () => {
    mocks.prisma.staffMonthlyInvoice.findUnique.mockResolvedValue({ ...DUE_RENT, status: "GENERATED", invoiceId: "inv_new" });
    expect((await acceptStaffRentPayment({ rentId: "smi_1" })).success).toBe(false);
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();

    mocks.prisma.staffMonthlyInvoice.findUnique.mockResolvedValue(DUE_RENT);
    mocks.tx = makeTx({ rowClaim: 0 });
    expect((await acceptStaffRentPayment({ rentId: "smi_1" })).success).toBe(false);
    expect(mocks.issueInvoice).not.toHaveBeenCalled();
    expect(mocks.tx.transaction.create).not.toHaveBeenCalled();
  });
});

describe("a rent invoice issued before this rule (invoice first)", () => {
  it("accepting records its payment against the existing invoice — no new invoice", async () => {
    mocks.tx = makeTx({ payment: { status: "PENDING", totalAmount: "100.00", paidAmount: "0.00" } });
    const result = await acceptStaffRentPayment({ invoiceId: "inv_old" });
    expect(result).toMatchObject({ success: true, data: { invoice: null } });
    expect(mocks.tx.payment.create.mock.calls[0][0].data).toMatchObject({ staffContractId: "c_old", status: "PENDING" });
    expect(mocks.tx.invoice.updateMany).toHaveBeenCalledWith({ where: { id: "inv_old", paymentId: null }, data: { paymentId: "p_new" } });
    expect(mocks.tx.transaction.create.mock.calls[0][0].data).toMatchObject({ paymentId: "p_new", amount: 100, method: "TRANSFER" });
    expect(mocks.issueInvoice).not.toHaveBeenCalled();
  });

  it("refuses a credited, superseded, non-rent or contract-less invoice, and a lost race", async () => {
    const cases = [
      makeTx({ invoice: { ...LEGACY_INVOICE, creditNotes: [{ totalInclVat: "100.00" }] } }),
      makeTx({ invoice: { ...LEGACY_INVOICE, supersededAt: new Date() } }),
      makeTx({ invoice: { ...LEGACY_INVOICE, source: "MANUAL" } }),
      makeTx({ invoice: { ...LEGACY_INVOICE, contractId: null } }),
      makeTx({ linkCount: 0 }),
      makeTx({ invoice: { ...LEGACY_INVOICE, paymentId: "p_old" }, payment: { status: "PAID", totalAmount: "100.00", paidAmount: "100.00" } }),
    ];
    for (const tx of cases) {
      mocks.tx = tx;
      expect((await acceptStaffRentPayment({ invoiceId: "inv_old" })).success).toBe(false);
      expect(tx.transaction.create).not.toHaveBeenCalled();
    }
  });
});

describe("the pending list", () => {
  it("lists rents due (not invoiced yet) and pre-rule rent invoices still unpaid — never credited ones", async () => {
    mocks.prisma.staffMonthlyInvoice.findMany.mockResolvedValue([
      {
        id: "smi_1",
        generatedAt: new Date(),
        dueDate: null,
        amount: "500.00",
        lineDescription: "Location d'espace — octobre 2026",
        staff: { user: { fullName: "Lyly", email: "lyly@example.com" } },
        payment: { paidAmount: "0.00" },
      },
    ]);
    mocks.prisma.invoice.findMany.mockResolvedValue([
      { ...LEGACY_INVOICE, issuedAt: new Date(), dueDate: null, customerName: "Bounagat", customerLegalName: null, customerEmail: "b@example.com", lines: [], payment: null },
      { ...LEGACY_INVOICE, id: "inv_credited", number: "F-2026-000011", issuedAt: new Date(), dueDate: null, customerName: "Rose", customerLegalName: null, customerEmail: "r@example.com", lines: [], creditNotes: [{ totalInclVat: "100.00" }], payment: null },
    ]);
    const result = await listPendingStaffRent();
    expect(mocks.prisma.staffMonthlyInvoice.findMany.mock.calls[0][0].where).toEqual({
      status: "AWAITING_PAYMENT",
      invoiceId: null,
      payment: { is: { status: { in: ["PENDING", "PARTIALLY_PAID"] } } },
    });
    expect(result.data.rows).toEqual([
      expect.objectContaining({ kind: "RENT", rentId: "smi_1", number: null, staffName: "Lyly", remainingAmount: 500 }),
      expect.objectContaining({ kind: "LEGACY_INVOICE", invoiceId: "inv_old", number: "F-2026-000010", remainingAmount: 100 }),
    ]);
    expect(result.data.stats).toEqual({ count: 2, remainingTotal: 600 });
  });
});

describe("accepted rent is salon revenue, in its own category", () => {
  it("« Loyers staff »: by its contract source, or a pre-rule invoice's source", () => {
    expect(categoryForPayment({ staffContractId: "c_lyly" })).toBe("STAFF_RENT");
    expect(categoryForPayment({ invoice: { source: "STAFF_CONTRACT" } })).toBe("STAFF_RENT");
    expect(RECETTES_CATEGORIES).toContain("STAFF_RENT");
  });

  it("a rent invoice still offers no credit-note path, payment or not", () => {
    expect(creditNoteEligibility({ source: "STAFF_CONTRACT", paymentId: "p_rent", totalInclVat: 500 }).allowed).toBe(false);
  });
});

describe("schema", () => {
  it("the rent contract is a fifth Payment source, in the DB CHECK too", () => {
    const sql = source("prisma/migrations/20260921120400_staff_rent_payment/migration.sql");
    expect(sql).toContain('(CASE WHEN "staffContractId" IS NOT NULL THEN 1 ELSE 0 END) = 1');
    expect(sql).toContain('(CASE WHEN "formationReservationId" IS NOT NULL THEN 1 ELSE 0 END) +');
  });

  it("a rent period can await its payment", () => {
    const sql = source("prisma/migrations/20260921120500_staff_rent_awaiting_payment/migration.sql");
    expect(sql).toContain("ADD VALUE IF NOT EXISTS 'AWAITING_PAYMENT'");
    expect(sql).toContain('"StaffMonthlyInvoice_paymentId_key"');
  });
});

describe("the « Facturation mensuelle » page is gone, the logic stays", () => {
  it("no page, client, page actions, page-only API routes or sidebar link", () => {
    for (const path of [
      "app/dashboard/staff-invoices/page.jsx",
      "components/dashboard/staff-invoices/StaffInvoicesClient.jsx",
      "actions/dashboard/staff-invoices.js",
      "app/api/staff-invoices/[id]/pdf/route.js",
      "app/api/staff-invoices/[id]/resend/route.js",
    ]) {
      expect(existsSync(`${root}${path}`), path).toBe(false);
    }
    expect(source("components/dashboard/Layouts/sidebar/data/index.js")).not.toContain("/dashboard/staff-invoices");
  });

  it("the billing engine and its daily run are still there", () => {
    expect(source("lib/background-jobs.js")).toContain("sendDailyStaffInvoices");
    expect(existsSync(`${root}app/api/cron/monthly-staff-billing/route.js`)).toBe(true);
  });

  it("the Factures page shows the rent awaiting its transfer, in the invoice table itself", () => {
    const page = source("app/dashboard/factures/page.jsx");
    expect(page).toContain("listPendingStaffRent()");
    expect(page).toContain("buildPendingPaymentRows({");
    expect(page).toContain("<InvoicesClient data={result.data} pendingRows={pendingRows} />");
    // The separate panel is gone: one table, one « Paiement » column, one tick.
    expect(existsSync(`${root}components/dashboard/invoices/PendingStaffRent.jsx`)).toBe(false);
    const client = source("components/dashboard/invoices/InvoicesClient.jsx");
    expect(client).toContain("acceptStaffRentPayment(row.accept)");
    expect(client).toContain("<DocumentDeliveryDialog");
  });
});
