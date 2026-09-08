import { describe, it, expect, vi, beforeEach } from "vitest";
import { collectionTicketFields, consolidatedTicketFields } from "@/lib/cash-book/ticket-identity";

const mocks = vi.hoisted(() => ({ payment: vi.fn(), salon: vi.fn(), auth: vi.fn(), render: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { payment: { findUnique: mocks.payment }, salon: { findUnique: mocks.salon } } }));
vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/authorization", () => ({ canAccessDashboard: (role) => role === "ADMIN" }));
vi.mock("@/lib/pdf/render", () => ({ renderTicketPdf: mocks.render }));
vi.mock("@/lib/cash-book/reservation-tickets", () => ({ describeReservationPayment: () => "Prestation" }));
import { GET } from "@/app/api/payments/[id]/ticket/route";

const deposit = { id: "deposit-1", transactionType: "DEPOSIT", amount: 60.5, paidAt: new Date("2026-09-01T10:00:00Z"), pieceNumber: "R0007" };
const balance = { id: "balance-1", transactionType: "FINAL_PAYMENT", amount: 60.5, paidAt: new Date("2026-09-05T10:00:00Z"), pieceNumber: "R0008" };
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

  // The cash-book line this collection produced (see lib/cash-book/piece-number.js) —
  // CARD/ONLINE transactions never get one, so the ticket must not invent one either.
  it("carries the transaction's own piece number onto the ticket, cash-only", () => {
    expect(collectionTicketFields(deposit, invoice).pieceNumber).toBe("R0007");
    expect(collectionTicketFields({ ...deposit, pieceNumber: null }, invoice).pieceNumber).toBeNull();
    expect(collectionTicketFields({ ...deposit, pieceNumber: undefined }, invoice).pieceNumber).toBeNull();
  });
});

describe("consolidated receipt for a whole payment", () => {
  it("sums the legs under one payment-scoped identity", () => {
    const receipt = consolidatedTicketFields("payment-1", [deposit, balance], invoice);
    expect(receipt.ticketNumber).toBe("T-payment-1");
    expect(receipt.totalInclVat).toBe(121);
    expect(receipt.subtotalExclVat).toBe(100);
    expect(receipt.vatAmount).toBe(21);
    expect(receipt.vatRate).toBe(21);
    // The sale is only settled at the last movement.
    expect(receipt.issuedAt).toEqual(balance.paidAt);
    // The legal cash-book link is the last cash leg's piece number.
    expect(receipt.pieceNumber).toBe("R0008");
  });
  it("prints an acompte/solde breakdown, ordered by date", () => {
    const receipt = consolidatedTicketFields("payment-1", [balance, deposit], invoice);
    expect(receipt.payments.map((p) => p.label)).toEqual(["Acompte", "Solde"]);
    expect(receipt.payments.map((p) => p.amount)).toEqual([60.5, 60.5]);
    expect(receipt.payments[0].issuedAt).toEqual(deposit.paidAt);
  });
  it("collapses to a single leg for a full one-shot payment", () => {
    const receipt = consolidatedTicketFields("payment-1", [deposit], invoice);
    expect(receipt.ticketNumber).toBe("T-payment-1");
    expect(receipt.totalInclVat).toBe(60.5);
    expect(receipt.payments).toHaveLength(1);
  });
  it("has no piece number when every leg was paid online", () => {
    const online = [
      { ...deposit, pieceNumber: null },
      { ...balance, pieceNumber: null },
    ];
    expect(consolidatedTicketFields("payment-1", online, invoice).pieceNumber).toBeNull();
  });
  it.each([
    ["no legs", "payment-1", []],
    ["falsy payment id", "", [deposit]],
    ["only refunds", "payment-1", [{ ...deposit, transactionType: "REFUND" }]],
  ])("throws rather than inventing a receipt: %s", (_label, paymentId, rows) => {
    expect(() => consolidatedTicketFields(paymentId, rows, invoice)).toThrow();
  });
});

// Staff/dashboard reprint only — a client can no longer fetch their own
// ticket, so every success case here authenticates as staff (ADMIN, per the
// canAccessDashboard mock above).
describe("reservation ticket reprints", () => {
  beforeEach(() => {
    mocks.auth.mockResolvedValue({ user: { id: "staff-1", role: "ADMIN" } });
    mocks.payment.mockResolvedValue({ invoice, appointment: { user: {} }, transactions: [deposit, balance] });
    mocks.render.mockResolvedValue(Buffer.from("pdf"));
  });
  const request = (query = "") => GET(new Request(`http://localhost/api/payments/payment-1/ticket${query}`), { params: Promise.resolve({ id: "payment-1" }) });
  it("reprints one consolidated ticket with an acompte/solde breakdown", async () => {
    expect((await request()).status).toBe(200);
    const ticket = mocks.render.mock.calls[0][0];
    expect(Array.isArray(ticket)).toBe(false);
    expect(ticket.ticketNumber).toBe("T-payment-1");
    expect(ticket.totalInclVat).toBe(121);
    expect(ticket.payments.map((p) => p.label)).toEqual(["Acompte", "Solde"]);
    expect(ticket.issuedAt).toEqual(balance.paidAt);
  });
  it("can still print a single collection on its own", async () => {
    expect((await request("?transactionId=deposit-1")).status).toBe(200);
    const ticket = mocks.render.mock.calls[0][0];
    expect(Array.isArray(ticket)).toBe(false);
    expect(ticket.ticketNumber).toBe("T-deposit-1");
    expect(ticket.payments).toBeUndefined();
  });
  it("rejects a transaction not belonging to this payment", async () => {
    expect((await request("?transactionId=another-payment-transaction")).status).toBe(404);
    expect(mocks.render).not.toHaveBeenCalled();
  });
  it("rejects a non-dashboard caller — the reservation's own owner included, this is staff-only now", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "client-1", role: "CUSTOMER" } });
    expect((await request()).status).toBe(403);
    expect(mocks.render).not.toHaveBeenCalled();
    expect(mocks.payment).not.toHaveBeenCalled();
  });
  it("reprints a B2C payment without requiring an invoice", async () => {
    mocks.payment.mockResolvedValue({ invoice: null, appointment: { user: {} }, transactions: [deposit] });
    mocks.salon.mockResolvedValue({ legalName: "Salon" });
    expect((await request()).status).toBe(200);
    expect(mocks.render.mock.calls[0][0]).toMatchObject({ ticketNumber: "T-payment-1", invoiceNumber: null, totalInclVat: 60.5 });
  });
  it("does not fabricate receipts for an unpaid reservation", async () => {
    mocks.payment.mockResolvedValue({ invoice, appointment: { user: {} }, transactions: [] });
    expect((await request()).status).toBe(404);
    expect(mocks.render).not.toHaveBeenCalled();
  });
});
