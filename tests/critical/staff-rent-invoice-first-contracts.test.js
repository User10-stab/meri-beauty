import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Staff rent, since 2026-09-22 (user's call, reversing the payment-first rule
 * of the day before): the invoice is issued when the rent falls due, unpaid
 * and with its échéance, so it can be sent before the staff member pays.
 * « Accepter » only records the money. A mistake is corrected by a credit
 * note — before payment it lowers what is owed, after payment it goes with
 * the refund transfer Marie made.
 */

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  prisma: {
    staffMonthlyInvoice: { findUnique: vi.fn(), findMany: vi.fn() },
    user: { findUnique: vi.fn() },
    $transaction: vi.fn(),
  },
  tx: null,
  issueInvoice: vi.fn(),
  issueCreditNote: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/invoicing", () => ({ issueInvoice: mocks.issueInvoice, issueCreditNote: mocks.issueCreditNote }));
vi.mock("@/lib/peppyrus", () => ({ isBelgianVatNumber: (vat) => String(vat ?? "").startsWith("BE") }));

import { issueRentInvoiceNow } from "@/lib/staff-rent-payment";
import { creditStaffRentInvoice, issueStaffRentInvoice } from "@/actions/invoices/staff-rent";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8").replace(/\r\n/g, "\n");

const ADMIN = { id: "u_admin", role: "ADMIN", email: "admin@meribeauty.com" };
const DUE = new Date("2026-09-30T00:00:00Z");

const RENT = {
  id: "smi_lyly",
  status: "AWAITING_PAYMENT",
  invoiceId: null,
  paymentId: "p_rent",
  amount: "500.00",
  lineDescription: "Location d'une cabine professionnelle — septembre 2026",
  dueDate: DUE,
  staff: { id: "s_lyly", vatNumber: "BE0660821903", user: { id: "u_lyly", fullName: "Lyly Hannecart", email: "lyly@example.com" } },
};

const ISSUED = { id: "inv_13", number: "F-2026-000013", totalInclVat: "500.00", customerName: "Lyly Hannecart", customerType: "B2B", customerVatNumber: "BE0660821903" };

function rentInvoice({ paidAmount = "0.00", status = "PENDING", totalAmount = "500.00", creditNotes = [], refunds = [] } = {}) {
  return {
    id: "inv_13",
    number: "F-2026-000013",
    source: "STAFF_CONTRACT",
    supersededAt: null,
    totalInclVat: "500.00",
    paymentId: "p_rent",
    creditNotes,
    payment: { id: "p_rent", status, totalAmount, paidAmount, transactions: refunds },
  };
}

function makeTx({ rowClaim = 1, invoice = rentInvoice(), paymentClaim = 1 } = {}) {
  return {
    staffMonthlyInvoice: { updateMany: vi.fn().mockResolvedValue({ count: rowClaim }), update: vi.fn().mockResolvedValue({}) },
    invoice: { findUnique: vi.fn().mockResolvedValue(invoice) },
    payment: { updateMany: vi.fn().mockResolvedValue({ count: paymentClaim }) },
    transaction: { create: vi.fn() },
    auditLog: { create: vi.fn() },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ user: ADMIN });
  mocks.tx = makeTx();
  mocks.prisma.$transaction.mockImplementation((fn) => fn(mocks.tx));
  mocks.prisma.staffMonthlyInvoice.findUnique.mockResolvedValue(RENT);
  mocks.prisma.staffMonthlyInvoice.findMany.mockResolvedValue([]);
  mocks.prisma.user.findUnique.mockResolvedValue(null);
  mocks.issueInvoice.mockResolvedValue(ISSUED);
  mocks.issueCreditNote.mockResolvedValue({ id: "cn_1", number: "NC2026-000001" });
});

describe("a rent is invoiced when it falls due — unpaid, with its échéance", () => {
  it("claims the row, issues the invoice with the échéance, links it — the Payment stays PENDING", async () => {
    const invoice = await issueRentInvoiceNow("smi_lyly");
    expect(invoice.number).toBe("F-2026-000013");
    expect(mocks.tx.staffMonthlyInvoice.updateMany).toHaveBeenCalledWith({
      where: { id: "smi_lyly", status: "AWAITING_PAYMENT", invoiceId: null },
      data: { status: "GENERATED" },
    });
    expect(mocks.issueInvoice).toHaveBeenCalledWith(
      mocks.tx,
      expect.objectContaining({ paymentId: "p_rent", source: "STAFF_CONTRACT", totalInclVat: 500, dueDate: DUE })
    );
    expect(mocks.tx.staffMonthlyInvoice.update).toHaveBeenCalledWith({ where: { id: "smi_lyly" }, data: { invoiceId: "inv_13" } });
    // Nothing is recorded as received.
    expect(mocks.tx.transaction.create).not.toHaveBeenCalled();
    expect(mocks.tx.payment.updateMany).not.toHaveBeenCalled();
    expect(mocks.tx.auditLog.create.mock.calls[0][0].data).toMatchObject({ action: "staff_rent.invoice_issued", actorId: null });
  });

  it("the billing job and a click can never issue two invoices for one rent", async () => {
    mocks.tx = makeTx({ rowClaim: 0 });
    await expect(issueRentInvoiceNow("smi_lyly")).rejects.toThrow("STAFF_RENT_ALREADY_INVOICED");
    expect(mocks.issueInvoice).not.toHaveBeenCalled();

    mocks.prisma.staffMonthlyInvoice.findUnique.mockResolvedValue({ ...RENT, status: "GENERATED", invoiceId: "inv_13" });
    await expect(issueRentInvoiceNow("smi_lyly")).rejects.toThrow("STAFF_RENT_ALREADY_INVOICED");
  });

  it("« Émettre la facture » is admin-only, names who did it, and offers the invoice for sending", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "u_julie", role: "STAFF" } });
    expect((await issueStaffRentInvoice({ rentId: "smi_lyly" })).success).toBe(false);
    expect(mocks.issueInvoice).not.toHaveBeenCalled();

    mocks.auth.mockResolvedValue({ user: ADMIN });
    const result = await issueStaffRentInvoice({ rentId: "smi_lyly" });
    expect(result).toMatchObject({ success: true, data: { invoice: { number: "F-2026-000013", peppolApplicable: true } } });
    expect(mocks.tx.auditLog.create.mock.calls[0][0].data).toMatchObject({ actorId: "u_admin", actorRole: "ADMIN" });
  });

  it("the billing job issues right after recording, and a refused invoice leaves the rent recorded", () => {
    const billing = source("lib/staff-monthly-billing.js");
    expect(billing).toContain("invoiceNumber = (await issueRentInvoiceNow(pending.id)).number;");
    expect(billing).toContain('status: invoiceNumber ? "GENERATED" : "AWAITING_PAYMENT"');
    expect(source("lib/staff-invoice.js")).toContain("invoice = await issueRentInvoiceNow(pendingRent.id);");
  });

  it("only a rent invoice prints an échéance, paid or not", () => {
    const pdf = source("lib/pdf/InvoiceDocument.jsx");
    expect(pdf).toContain('invoice.source === "STAFF_CONTRACT" && invoice.dueDate ? formatDate(invoice.dueDate) : null');
    expect(pdf).toContain('rentDue ? { label: "Échéance", value: rentDue } : null');
    // No other path passes a due date to issueInvoice.
    for (const file of ["lib/invoices/manual-sale-invoice.js", "lib/payments/awaited-transfer.js"]) {
      expect(source(file), file).not.toContain("dueDate");
    }
  });
});

describe("a credit note on a rent invoice, for a mistake", () => {
  it("unpaid: the note lowers what the rent still expects — no money moves", async () => {
    const result = await creditStaffRentInvoice({ invoiceId: "inv_13", amount: 200, reason: "Erreur de montant" });
    expect(result).toMatchObject({ success: true, message: expect.stringContaining("NC2026-000001") });
    expect(mocks.issueCreditNote).toHaveBeenCalledWith(mocks.tx, { invoiceId: "inv_13", reason: "Erreur de montant", totalInclVat: 200 });
    expect(mocks.tx.payment.updateMany).toHaveBeenCalledWith({
      where: { id: "p_rent", status: "PENDING", paidAmount: "0.00", totalAmount: "500.00" },
      data: { totalAmount: 300, remainingAmount: 300 },
    });
    expect(mocks.tx.transaction.create).not.toHaveBeenCalled();
  });

  it("defaults to everything not yet credited, and never beyond it", async () => {
    mocks.tx = makeTx({ invoice: rentInvoice({ creditNotes: [{ totalInclVat: "200.00" }], totalAmount: "300.00" }) });
    await creditStaffRentInvoice({ invoiceId: "inv_13", reason: "Contrat annulé" });
    expect(mocks.issueCreditNote.mock.calls[0][1].totalInclVat).toBe(300);

    mocks.issueCreditNote.mockClear();
    const tooMuch = await creditStaffRentInvoice({ invoiceId: "inv_13", amount: 301, reason: "Contrat annulé" });
    expect(tooMuch.success).toBe(false);
    expect(mocks.issueCreditNote).not.toHaveBeenCalled();
  });

  it("paid: refused until Marie confirms the refund transfer was sent — nothing is written", async () => {
    mocks.tx = makeTx({ invoice: rentInvoice({ paidAmount: "500.00", status: "PAID" }) });
    const result = await creditStaffRentInvoice({ invoiceId: "inv_13", reason: "Loyer facturé deux fois" });
    expect(result).toMatchObject({ success: false, message: expect.stringContaining("remboursement") });
    expect(mocks.issueCreditNote).not.toHaveBeenCalled();
    expect(mocks.tx.transaction.create).not.toHaveBeenCalled();
  });

  it("paid and refunded: the note and the REFUND transfer are recorded together, linked", async () => {
    mocks.tx = makeTx({ invoice: rentInvoice({ paidAmount: "500.00", status: "PAID" }) });
    const result = await creditStaffRentInvoice({
      invoiceId: "inv_13",
      reason: "Loyer facturé deux fois",
      refundSent: true,
      refundReference: "Remb. sept",
    });
    expect(result).toMatchObject({ success: true, message: expect.stringContaining("remboursement par virement") });
    expect(mocks.tx.payment.updateMany.mock.calls[0][0].data).toEqual({ status: "REFUNDED" });
    expect(mocks.tx.transaction.create.mock.calls[0][0].data).toMatchObject({
      paymentId: "p_rent",
      amount: 500,
      method: "TRANSFER",
      transactionType: "REFUND",
      manualReference: "Remb. sept",
      creditNoteId: "cn_1",
      cashSessionId: null,
    });
  });

  it("a partial refund leaves the payment PARTIALLY_REFUNDED", async () => {
    mocks.tx = makeTx({ invoice: rentInvoice({ paidAmount: "500.00", status: "PAID" }) });
    await creditStaffRentInvoice({ invoiceId: "inv_13", amount: 100, reason: "Remise accordée", refundSent: true });
    expect(mocks.tx.payment.updateMany.mock.calls[0][0].data).toEqual({ status: "PARTIALLY_REFUNDED" });
  });

  it("a reason is required, and only a rent invoice goes through here", async () => {
    expect((await creditStaffRentInvoice({ invoiceId: "inv_13", reason: "" })).success).toBe(false);
    mocks.tx = makeTx({ invoice: { ...rentInvoice(), source: "ORDER" } });
    expect((await creditStaffRentInvoice({ invoiceId: "inv_13", reason: "Erreur" })).success).toBe(false);
    expect(mocks.issueCreditNote).not.toHaveBeenCalled();
  });

  it("the Factures table opens the rent dialog for a rent invoice, the sale flow otherwise", () => {
    const client = source("components/dashboard/invoices/InvoicesClient.jsx");
    expect(client).toContain('invoice.source === "STAFF_CONTRACT" ? setRentCreditFor(invoice) : setCreditNoteFor(invoice)');
    expect(client).toContain("<CreditStaffRentDialog invoice={rentCreditFor}");
    expect(client).toContain('aria-label="Émettre la facture"');
    const dialog = source("components/dashboard/invoices/CreditStaffRentDialog.jsx");
    expect(dialog).toContain("const canSubmit = amountValid && reason.trim().length >= 3 && (!paid || refundSent);");
  });
});

describe("« Émettre la facture » asks how to send it first, and never marks it paid (user's call, 2026-09-22)", () => {
  const client = source("components/dashboard/invoices/InvoicesClient.jsx");
  const card = source("components/dashboard/operations/DocumentDeliveryDialog.jsx");

  it("the button only opens the send card on a draft — nothing is issued by the click", () => {
    const issueRent = client.slice(client.indexOf("async function issueRent("), client.indexOf("async function issueRentNow("));
    expect(issueRent).toContain("getStaffRentIssueDraft(");
    expect(issueRent).not.toContain("issueStaffRentInvoice(");
    expect(client).toContain("issue={issueRentNow}");
  });

  it("the card issues the invoice only on the final confirm, then sends it", () => {
    const deliver = card.slice(card.indexOf("async function deliver("), card.indexOf("return (\n    <>"));
    const issued = deliver.indexOf("await issue()");
    expect(issued).toBeGreaterThan(-1);
    expect(deliver.indexOf("sendInvoiceByEmail(documentId")).toBeGreaterThan(issued);
    expect(deliver.indexOf("sendInvoiceToPeppyrus(documentId")).toBeGreaterThan(issued);
    // A refused issue stops there: nothing is sent.
    expect(deliver.slice(issued, deliver.indexOf("setIssued("))).toContain("return;");
  });

  it("the Paiement column reads the real payment status: issued or sent is not paid", () => {
    expect(source("actions/dashboard/invoices.js")).toContain("paymentStatus: invoice.payment?.status ?? null");
    expect(client).toContain('const OPEN_PAYMENT = ["PENDING", "PARTIALLY_PAID"];');
    expect(client).toContain("<PaymentCell pending={pending} invoice={invoice} />");
  });

  it("the draft shows the number it should get, read without taking it", () => {
    const peek = source("lib/invoicing.js");
    const body = peek.slice(peek.indexOf("export async function peekNextInvoiceNumber("));
    expect(body.slice(0, body.indexOf("\n}\n"))).not.toMatch(/INSERT|update|upsert/);
    expect(source("lib/invoices/invoice-preview.js")).toContain("await peekNextInvoiceNumber(prisma, planned.ahead ?? 0)");
  });
});

describe("rent invoices take successive numbers, oldest rent first (user's call, 2026-09-22)", () => {
  it("a younger rent cannot be issued while an older one waits — nothing is numbered", async () => {
    mocks.prisma.staffMonthlyInvoice.findMany.mockResolvedValue([
      { id: "smi_old", lineDescription: "Location d'espace — septembre 2026", staff: { user: { fullName: "Lyly" } } },
    ]);
    const result = await issueStaffRentInvoice({ rentId: "smi_rose" });
    expect(result.success).toBe(false);
    expect(result.message).toContain("Lyly");
    expect(mocks.issueInvoice).not.toHaveBeenCalled();
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("the queue is the rents' age, and each draft counts the older ones ahead of it", () => {
    const helper = source("lib/staff-rent-payment.js");
    expect(helper).toContain('export const UNISSUED_RENT_ORDER = [{ generatedAt: "asc" }, { id: "asc" }];');
    expect(helper).toContain("OR: [{ generatedAt: { lt: rent.generatedAt } }, { generatedAt: rent.generatedAt, id: { lt: rent.id } }]");
    expect(source("lib/invoicing.js")).toContain('+ 1 + ahead).padStart(6, "0")');
    const actions = source("actions/invoices/staff-rent.js");
    expect(actions).toContain("orderBy: UNISSUED_RENT_ORDER,");
    expect(actions).toContain("issueAfter: index > 0 ?");
    expect(source("components/dashboard/invoices/InvoicesClient.jsx")).toContain("disabled={busy || Boolean(pending.issueAfter)}");
  });
});
