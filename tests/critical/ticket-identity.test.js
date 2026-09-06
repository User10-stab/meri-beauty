import { describe, it, expect, vi, beforeEach } from "vitest";
import { collectionTicketFields } from "@/lib/cash-book/ticket-identity";

const mocks = vi.hoisted(() => ({ payment: vi.fn(), salon: vi.fn(), auth: vi.fn(), render: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { payment: { findUnique: mocks.payment }, salon: { findUnique: mocks.salon } } }));
vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/authorization", () => ({ canAccessDashboard: (role) => role === "ADMIN" }));
vi.mock("@/lib/pdf/render", () => ({ renderTicketPdf: mocks.render }));
vi.mock("@/lib/cash-book/reservation-tickets", () => ({ describeReservationPayment: () => "Prestation" }));
import { GET } from "@/app/api/payments/[id]/ticket/route";

const deposit = { id: "deposit-1", transactionType: "DEPOSIT", amount: 60.5, paidAt: new Date("2026-09-01T10:00:00Z") };
const balance = { id: "balance-1", transactionType: "FINAL_PAYMENT", amount: 60.5, paidAt: new Date("2026-09-05T10:00:00Z") };
const invoice = { number: "F-2026-000065", vatRate: 21, totalInclVat: 121, sellerName: "Salon" };

describe("receipt identity and invoice association", () => {
  it("keeps the identity/date when the invoice is added later", () => {
    const before = collectionTicketFields(deposit, null, 21);
    const after = collectionTicketFields(deposit, invoice);
    expect(after.ticketNumber).toBe(before.ticketNumber);
    expect(after.issuedAt).toEqual(deposit.paidAt);
    expect(before.invoiceNumber).toBeNull();
    expect(after.invoiceNumber).toBe(invoice.number);
    expect(after.ticketNumber).not.toBe(invoice.number);
  });
  it("issues distinct deposit/balance receipts linked to one invoice", () => {
    const first = collectionTicketFields(deposit, invoice);
    const second = collectionTicketFields(balance, invoice);
    expect(first.ticketNumber).not.toBe(second.ticketNumber);
    expect(first.totalInclVat).toBe(60.5);
    expect(second.totalInclVat).toBe(60.5);
    expect(first.subtotalExclVat).toBe(50);
    expect(second.vatAmount).toBe(10.5);
    expect(first.invoiceNumber).toBe(second.invoiceNumber);
    expect(invoice.totalInclVat).toBe(121);
  });
  it.each([
    { ...deposit, transactionType: "REFUND" },
    { ...deposit, amount: 0 },
    { ...deposit, isDeleted: true },
    { ...deposit, id: null },
  ])("does not invent a collection receipt for invalid data", (row) => {
    expect(() => collectionTicketFields(row, invoice)).toThrow();
  });
});

describe("reservation ticket reprints", () => {
  beforeEach(() => {
    mocks.auth.mockResolvedValue({ user: { id: "client-1", role: "CUSTOMER" } });
    mocks.payment.mockResolvedValue({ invoice, appointment: { userId: "client-1" }, transactions: [deposit, balance] });
    mocks.render.mockResolvedValue(Buffer.from("pdf"));
  });
  const request = (query = "") => GET(new Request(`http://localhost/api/payments/payment-1/ticket${query}`), { params: Promise.resolve({ id: "payment-1" }) });
  it("reprints every collection with its own amount, number and original date", async () => {
    expect((await request()).status).toBe(200);
    const tickets = mocks.render.mock.calls[0][0];
    expect(tickets).toHaveLength(2);
    expect(tickets.map((t) => t.ticketNumber)).toEqual(["T-deposit-1", "T-balance-1"]);
    expect(tickets.map((t) => t.totalInclVat)).toEqual([60.5, 60.5]);
    expect(tickets[0].issuedAt).toEqual(deposit.paidAt);
  });
  it("can select a deposit without returning the later balance", async () => {
    expect((await request("?transactionId=deposit-1")).status).toBe(200);
    expect(mocks.render.mock.calls[0][0]).toHaveLength(1);
  });
  it("rejects a transaction not belonging to this payment", async () => {
    expect((await request("?transactionId=another-payment-transaction")).status).toBe(404);
    expect(mocks.render).not.toHaveBeenCalled();
  });
  it("rejects another customer's payment", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "other", role: "CUSTOMER" } });
    expect((await request()).status).toBe(403);
    expect(mocks.render).not.toHaveBeenCalled();
  });
  it("reprints a B2C collection without requiring an invoice", async () => {
    mocks.payment.mockResolvedValue({ invoice: null, appointment: { userId: "client-1", user: {} }, transactions: [deposit] });
    mocks.salon.mockResolvedValue({ legalName: "Salon" });
    expect((await request()).status).toBe(200);
    expect(mocks.render.mock.calls[0][0][0]).toMatchObject({ ticketNumber: "T-deposit-1", invoiceNumber: null, totalInclVat: 60.5 });
  });
  it("does not fabricate receipts for an unpaid reservation", async () => {
    mocks.payment.mockResolvedValue({ invoice, appointment: { userId: "client-1" }, transactions: [] });
    expect((await request()).status).toBe(404);
    expect(mocks.render).not.toHaveBeenCalled();
  });
});
