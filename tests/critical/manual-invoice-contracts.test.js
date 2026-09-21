import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Invoice sales at la caisse (actions/invoices/manual-invoice.js, CounterCart).
 *
 * The rule under test is the site-wide one for deposits: an invoice is only
 * issued once the sale is FULLY paid. Paid in full at creation → invoiced at
 * once. Acompte or nothing yet → a pending sale with no invoice, invoiced by
 * the payment that clears the balance.
 *
 * The invoice itself is written by the real-world issueInvoice, mocked here —
 * its own guards (B2C_INVOICE_NOT_ALLOWED before numbering, …) are covered by
 * b2c-no-invoice-contracts / vies-verified-b2b-invoice-contracts. What these
 * tests pin is everything the manual path adds around it: who may call it,
 * the sale it creates, when the invoice is issued, the cash book, stock,
 * cancellation and idempotency.
 */

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  prisma: {
    order: { findUnique: vi.fn(), findMany: vi.fn() },
    $transaction: vi.fn(),
  },
  tx: null,
  issueInvoice: vi.fn(),
  resolveCounterCustomer: vi.fn(),
  saveCheckoutVatNumber: vi.fn(),
  ensureCashSessionOpen: vi.fn(),
  allocatePieceNumber: vi.fn(),
  isSellerLegalDataComplete: vi.fn(),
  listAwaitedTransfers: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/prisma", () => ({ prisma: mocks.prisma }));
// The pending panel lists manual sales AND the counter's awaited transfers
// (booking balances, pickups, séances) — that half has its own test file.
vi.mock("@/actions/payments/awaited-transfer", () => ({ listAwaitedTransfers: mocks.listAwaitedTransfers }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/cash-book/revalidate-caisse", () => ({ revalidateCaisseRoutes: vi.fn() }));
vi.mock("@/lib/cash-book/session-lifecycle", () => ({ ensureCashSessionOpen: mocks.ensureCashSessionOpen }));
vi.mock("@/lib/cash-book/piece-number", () => ({
  allocatePieceNumber: mocks.allocatePieceNumber,
  PIECE_SERIES: { ORDER: "V" },
}));
vi.mock("@/lib/counter/resolve-counter-customer", () => ({ resolveCounterCustomer: mocks.resolveCounterCustomer }));
vi.mock("@/lib/customer-vat", () => ({ saveCheckoutVatNumber: mocks.saveCheckoutVatNumber }));
vi.mock("@/lib/invoicing", () => ({
  issueInvoice: mocks.issueInvoice,
  buildInvoiceCustomer: (user) => ({ fullName: user.fullName, email: user.email, vatNumber: user.vatNumber, address: user.addressLine1 ?? "" }),
  isSellerLegalDataComplete: mocks.isSellerLegalDataComplete,
  assertBuyerLegalDataComplete: (customer) => {
    if (!customer.address) throw Object.assign(new Error("BUYER_LEGAL_DATA_INCOMPLETE"), { userMessage: "Adresse manquante." });
  },
}));

import { cancelManualSale, createManualInvoice, listPendingManualSales, settleManualInvoice } from "@/actions/invoices/manual-invoice";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8").replace(/\r\n/g, "\n");

const ADMIN = { id: "u_admin", role: "ADMIN", email: "admin@meribeauty.com" };
const MARIE = { id: "u_marie", role: "STAFF", email: "contact@meribeautystudio.com" };
const INDEPENDENT = { id: "u_julie", role: "STAFF", email: "julie@example.com" };

const BELGIAN_BUYER = {
  id: "u_client",
  fullName: "Client SRL",
  email: "compta@client.be",
  vatNumber: "BE0417497106",
  vatValidatedAt: new Date(),
  addressLine1: "Rue Client 2",
  billingProfile: null,
};

const VARIANT = {
  id: "v1",
  name: "50 ml",
  sku: "SKU-1",
  price: "12.10",
  stockQuantity: 5,
  reservedQuantity: 1,
  product: { name: "Sérum" },
};

// What the sale's Order recorded — read back when the final payment issues the invoice.
const RECORDED_SALE = {
  totalAmount: "174.20",
  vatRate: "21.00",
  vatTreatment: "DOMESTIC",
  taxCountryCode: "BE",
  taxNote: null,
  invoiceNotes: "Merci de mentionner le numéro de facture.",
  items: [
    { productName: "Sérum", variantName: "50 ml", quantity: 2, unitPrice: "12.10" },
    { productName: "Formation privée — 2 h", variantName: null, quantity: 1, unitPrice: "150.00" },
  ],
};

function input(over = {}) {
  return {
    attemptKey: "attempt-key-0000000001",
    customer: {
      id: "u_client",
      fullName: "Client SRL",
      email: "compta@client.be",
      vatNumber: "BE0417497106",
      addressLine1: "Rue Client 2",
      addressCity: "Bruxelles",
      addressPostalCode: "1000",
      addressCountry: "BE",
    },
    lines: [
      { type: "PRODUCT", variantId: "v1", quantity: 2 },
      { type: "FREE", description: "Formation privée — 2 h", quantity: 1, unitPrice: 150 },
    ],
    notes: "Merci de mentionner le numéro de facture.",
    dueDate: "2026-10-15",
    settlement: { mode: "LATER" },
    ...over,
  };
}

function makeTx({
  buyer = BELGIAN_BUYER,
  variant = VARIANT,
  claimCount = 1,
  cancelClaimCount = 1,
  openSession = { id: "cs_1" },
  // The payment as settleInTx re-reads it inside the transaction.
  livePayment = { status: "PENDING", totalAmount: "174.20", paidAmount: "0.00" },
} = {}) {
  return {
    user: { findUnique: vi.fn().mockResolvedValue(buyer) },
    $queryRaw: vi.fn().mockResolvedValue([]),
    productVariant: {
      findFirst: vi.fn().mockResolvedValue(variant),
      update: vi.fn().mockImplementation(({ data }) =>
        Promise.resolve({
          stockQuantity: variant.stockQuantity - (data.stockQuantity.decrement ?? 0) + (data.stockQuantity.increment ?? 0),
        })
      ),
    },
    order: {
      create: vi.fn().mockImplementation(({ data }) =>
        Promise.resolve({
          id: "o_1",
          orderNumber: 77,
          totalAmount: data.totalAmount,
          vatRate: data.vatRate,
          vatTreatment: data.vatTreatment,
          taxCountryCode: data.taxCountryCode,
          taxNote: data.taxNote,
          invoiceNotes: data.invoiceNotes,
        })
      ),
      findUnique: vi.fn().mockResolvedValue({ id: "o_1", orderNumber: 77, ...RECORDED_SALE, items: RECORDED_SALE.items.map((item, i) => ({ ...item, variantId: i === 0 ? "v1" : null })) }),
      updateMany: vi.fn().mockResolvedValue({ count: cancelClaimCount }),
      update: vi.fn().mockResolvedValue({}),
    },
    payment: {
      create: vi.fn().mockResolvedValue({ id: "p_1" }),
      findUnique: vi.fn().mockResolvedValue(livePayment),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: claimCount }),
    },
    inventoryMovement: { create: vi.fn() },
    cashSession: { findFirst: vi.fn().mockResolvedValue(openSession) },
    transaction: { create: vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: "t_1", pieceNumber: data.pieceNumber })) },
    auditLog: { create: vi.fn() },
  };
}

const ISSUED = {
  id: "inv_1",
  number: "F-2026-000042",
  customerName: "Client SRL",
  customerLegalName: "Client SRL",
  customerEmail: "compta@client.be",
  customerType: "B2B",
  customerVatNumber: "BE0417497106",
  totalInclVat: "174.20",
};

// A pending manual sale as settleManualInvoice pre-reads it.
function pendingSale(over = {}) {
  return {
    id: "o_1",
    orderNumber: 77,
    source: "MANUAL",
    status: "COMPLETED",
    user: BELGIAN_BUYER,
    payment: { id: "p_1", status: "PENDING", totalAmount: "174.20", paidAmount: "0.00", invoice: null },
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ user: ADMIN });
  mocks.prisma.order.findUnique.mockResolvedValue(null);
  mocks.isSellerLegalDataComplete.mockResolvedValue(true);
  mocks.listAwaitedTransfers.mockResolvedValue({ success: true, data: { rows: [], remainingTotal: 0 } });
  mocks.resolveCounterCustomer.mockResolvedValue({ id: "u_client" });
  mocks.saveCheckoutVatNumber.mockResolvedValue({ success: true });
  mocks.ensureCashSessionOpen.mockResolvedValue({ id: "cs_1" });
  mocks.allocatePieceNumber.mockResolvedValue("V0042");
  mocks.issueInvoice.mockResolvedValue(ISSUED);
  mocks.tx = makeTx();
  mocks.prisma.$transaction.mockImplementation((fn) => fn(mocks.tx));
});

describe("who may record one", () => {
  it("the till's cash operators only — other staff and customers are refused before anything is read", async () => {
    for (const user of [null, INDEPENDENT, { id: "c", role: "CUSTOMER" }]) {
      mocks.auth.mockResolvedValue(user ? { user } : null);
      expect((await createManualInvoice(input())).success).toBe(false);
      expect((await settleManualInvoice({ orderId: "o_1", method: "TRANSFER", reference: "x" })).success).toBe(false);
      expect((await cancelManualSale({ orderId: "o_1", reason: "erreur" })).success).toBe(false);
      expect((await listPendingManualSales()).success).toBe(false);
    }
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
    expect(mocks.prisma.order.findMany).not.toHaveBeenCalled();
    expect(mocks.resolveCounterCustomer).not.toHaveBeenCalled();
  });

  it("Marie, the salon's own till operator, may record one like an admin", async () => {
    mocks.auth.mockResolvedValue({ user: MARIE });
    const result = await createManualInvoice(input());
    expect(result.success).toBe(true);
    expect(mocks.tx.order.create.mock.calls[0][0].data.createdByStaffId).toBe("u_marie");
  });

  it("the VAT number is mandatory — refused up front, before any customer is created", async () => {
    const result = await createManualInvoice(input({ customer: { ...input().customer, vatNumber: "" } }));
    expect(result).toMatchObject({ success: false, message: expect.stringContaining("TVA") });
    expect(mocks.resolveCounterCustomer).not.toHaveBeenCalled();
  });

  it("an incomplete salon identity blocks before any work", async () => {
    mocks.isSellerLegalDataComplete.mockResolvedValue(false);
    const result = await createManualInvoice(input());
    expect(result.success).toBe(false);
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe("a sale that could never be invoiced is refused at creation — whatever the mode", () => {
  it("buyer VAT number not VIES-validated: nothing recorded, even for « Payer plus tard »", async () => {
    mocks.tx = makeTx({ buyer: { ...BELGIAN_BUYER, vatValidatedAt: null } });
    for (const settlement of [{ mode: "LATER" }, { mode: "DEPOSIT", amount: 50, method: "CARD", reference: "r" }]) {
      const result = await createManualInvoice(input({ settlement }));
      expect(result).toMatchObject({ success: false, message: expect.stringContaining("assujetti") });
    }
    expect(mocks.tx.order.create).not.toHaveBeenCalled();
    expect(mocks.tx.transaction.create).not.toHaveBeenCalled();
  });

  it("buyer address missing: refused with issueInvoice's own message", async () => {
    mocks.tx = makeTx({ buyer: { ...BELGIAN_BUYER, addressLine1: null } });
    const result = await createManualInvoice(input());
    expect(result).toMatchObject({ success: false, message: "Adresse manquante." });
    expect(mocks.tx.order.create).not.toHaveBeenCalled();
  });
});

describe("« Payer plus tard »: a pending sale, no invoice", () => {
  it("records a COMPLETED manual order and a PENDING payment — and issues NO invoice", async () => {
    const result = await createManualInvoice(input());
    expect(result).toMatchObject({
      success: true,
      data: { invoice: null, sale: { orderId: "o_1", orderNumber: 77, totalAmount: 174.2, paidAmount: 0, remainingAmount: 174.2 } },
    });
    expect(mocks.issueInvoice).not.toHaveBeenCalled();

    const order = mocks.tx.order.create.mock.calls[0][0].data;
    // COMPLETED, never PENDING_PAYMENT — the expiry job cancels those.
    expect(order).toMatchObject({ source: "MANUAL", status: "COMPLETED", createdByStaffId: "u_admin", posAttemptKey: "attempt-key-0000000001" });
    // Comment and due date wait on the order until the invoice exists.
    expect(order.invoiceNotes).toBe("Merci de mentionner le numéro de facture.");
    expect(order.paymentDueDate).toEqual(new Date("2026-10-15T12:00:00"));

    expect(mocks.tx.payment.create.mock.calls[0][0].data).toMatchObject({ orderId: "o_1", status: "PENDING", paidAmount: 0, remainingAmount: 174.2 });
    expect(mocks.tx.payment.create.mock.calls[0][0].data).not.toHaveProperty("payeeStaffId");
    expect(mocks.tx.transaction.create).not.toHaveBeenCalled();
    expect(mocks.tx.auditLog.create.mock.calls[0][0].data).toMatchObject({ action: "manual_sale.created", entityType: "Order", entityId: "o_1" });
  });

  it("re-reads the catalogue price and keeps free lines as typed (no variant)", async () => {
    await createManualInvoice(input());
    expect(mocks.tx.order.create.mock.calls[0][0].data.items.create).toEqual([
      { variantId: "v1", productName: "Sérum", variantName: "50 ml", sku: "SKU-1", unitPrice: 12.1, quantity: 2 },
      { variantId: null, productName: "Formation privée — 2 h", variantName: null, sku: null, unitPrice: 150, quantity: 1 },
    ]);
  });

  it("takes catalogue goods out of stock at creation, with a SALE movement", async () => {
    await createManualInvoice(input());
    expect(mocks.tx.$queryRaw).toHaveBeenCalled(); // row lock
    expect(mocks.tx.productVariant.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "v1" }, data: { stockQuantity: { decrement: 2 } } }));
    expect(mocks.tx.inventoryMovement.create.mock.calls[0][0].data).toMatchObject({
      variantId: "v1",
      type: "SALE",
      quantity: -2,
      previousStock: 5,
      newStock: 3,
      reason: "Vente manuelle n°77",
    });
  });

  it("refuses more than the available stock (on hand minus reserved)", async () => {
    const result = await createManualInvoice(input({ lines: [{ type: "PRODUCT", variantId: "v1", quantity: 5 }] }));
    expect(result).toMatchObject({ success: false, message: expect.stringContaining("Stock insuffisant") });
    expect(mocks.tx.order.create).not.toHaveBeenCalled();
  });
});

describe("« Encaisser tout »: invoiced at once", () => {
  it("a terminal payment writes one FINAL_PAYMENT with its ticket reference, then issues the invoice — never the cash book", async () => {
    const result = await createManualInvoice(input({ settlement: { mode: "NOW", method: "CARD", reference: "004512" } }));
    expect(result).toMatchObject({ success: true, data: { invoice: { id: "inv_1", number: "F-2026-000042", peppolApplicable: true } } });
    expect(mocks.tx.payment.updateMany.mock.calls[0][0]).toMatchObject({
      // Locked on the exact amount already paid — see settleInTx.
      where: { id: "p_1", status: { in: ["PENDING", "PARTIALLY_PAID"] }, paidAmount: "0.00" },
      data: { status: "PAID", paidAmount: 174.2, remainingAmount: 0 },
    });
    expect(mocks.tx.transaction.create.mock.calls[0][0].data).toMatchObject({
      paymentId: "p_1",
      method: "CARD",
      transactionType: "FINAL_PAYMENT",
      amount: 174.2,
      manualReference: "004512",
      cashSessionId: null,
      pieceNumber: null,
    });
    expect(mocks.ensureCashSessionOpen).not.toHaveBeenCalled();
    expect(mocks.tx.auditLog.create.mock.calls[0][0].data).toMatchObject({ action: "invoice.manual_created", entityType: "Invoice" });
  });

  it("the invoice carries the composed lines, the comment, and no due date — it is issued paid", async () => {
    await createManualInvoice(input({ settlement: { mode: "NOW", method: "CARD", reference: "004512" } }));
    const call = mocks.issueInvoice.mock.calls[0][1];
    expect(call).toMatchObject({
      paymentId: "p_1",
      source: "MANUAL",
      totalInclVat: 174.2,
      vatRate: 21,
      notes: "Merci de mentionner le numéro de facture.",
      lines: [
        { description: "Sérum — 50 ml", quantity: 2, unitPrice: 12.1 },
        { description: "Formation privée — 2 h", quantity: 1, unitPrice: 150 },
      ],
    });
    expect(call.dueDate).toBeUndefined();
    expect(mocks.tx.order.create.mock.calls[0][0].data.paymentDueDate).toBeNull();
  });

  it("a validated foreign-EU company is invoiced at 0 % with catalogue prices taken net", async () => {
    mocks.tx = makeTx({ buyer: { ...BELGIAN_BUYER, vatNumber: "FR40303265045" }, livePayment: { status: "PENDING", totalAmount: "10.00", paidAmount: "0.00" } });
    await createManualInvoice(
      input({
        customer: { ...input().customer, vatNumber: "FR40303265045", addressCountry: "FR" },
        lines: [{ type: "PRODUCT", variantId: "v1", quantity: 1 }],
        settlement: { mode: "NOW", method: "CARD", reference: "r" },
      })
    );
    expect(mocks.issueInvoice).toHaveBeenCalledWith(
      mocks.tx,
      expect.objectContaining({ vatRate: 0, vatTreatment: "EU_REVERSE_CHARGE", totalInclVat: 10, lines: [expect.objectContaining({ unitPrice: 10 })] })
    );
  });

  it("a card payment without its terminal reference is refused", async () => {
    const result = await createManualInvoice(input({ settlement: { mode: "NOW", method: "CARD" } }));
    expect(result.success).toBe(false);
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("cash goes into the open till session with a cash-book piece number and the change given", async () => {
    await createManualInvoice(input({ settlement: { mode: "NOW", method: "CASH", cashReceived: 200 } }));
    expect(mocks.tx.transaction.create.mock.calls[0][0].data).toMatchObject({
      method: "CASH",
      cashSessionId: "cs_1",
      pieceNumber: "V0042",
      cashReceived: 200,
      changeGiven: 25.8,
      manualReference: null,
    });
  });

  it("cash with no till session open is refused before anything is written", async () => {
    mocks.ensureCashSessionOpen.mockResolvedValue(null);
    const result = await createManualInvoice(input({ settlement: { mode: "NOW", method: "CASH", cashReceived: 200 } }));
    expect(result).toMatchObject({ success: false, requiresCashSession: true });
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("too little cash rolls everything back — no invoice", async () => {
    const result = await createManualInvoice(input({ settlement: { mode: "NOW", method: "CASH", cashReceived: 100 } }));
    expect(result).toMatchObject({ success: false, message: expect.stringContaining("inférieur") });
    expect(mocks.tx.transaction.create).not.toHaveBeenCalled();
    expect(mocks.issueInvoice).not.toHaveBeenCalled();
  });
});

describe("« Acompte »: recorded, never invoiced", () => {
  it("records a DEPOSIT, leaves the balance due, never sets paidAt — and issues NO invoice", async () => {
    const result = await createManualInvoice(
      input({ settlement: { mode: "DEPOSIT", amount: 50, method: "CARD", reference: "004513" } })
    );
    expect(result.data).toMatchObject({ invoice: null, sale: { paidAmount: 50, remainingAmount: 124.2 } });
    expect(mocks.issueInvoice).not.toHaveBeenCalled();

    expect(mocks.tx.payment.create.mock.calls[0][0].data).toMatchObject({ depositAmount: 50, paymentType: "DEPOSIT", status: "PENDING" });
    const claim = mocks.tx.payment.updateMany.mock.calls[0][0];
    expect(claim.data).toMatchObject({ status: "PARTIALLY_PAID", paidAmount: 50, remainingAmount: 124.2 });
    expect(claim.data).not.toHaveProperty("paidAt");
    expect(mocks.tx.transaction.create.mock.calls[0][0].data).toMatchObject({ amount: 50, transactionType: "DEPOSIT", method: "CARD" });
  });

  it("an acompte equal to (or above) the total is refused before anything is recorded", async () => {
    for (const amount of [174.2, 200]) {
      const result = await createManualInvoice(input({ settlement: { mode: "DEPOSIT", amount, method: "CARD", reference: "ref" } }));
      expect(result).toMatchObject({ success: false, message: expect.stringContaining("Encaisser tout") });
    }
    expect(mocks.tx.order.create).not.toHaveBeenCalled();
  });

  it("a cash acompte only needs to cover the acompte, and goes to the cash book", async () => {
    await createManualInvoice(input({ settlement: { mode: "DEPOSIT", amount: 60, method: "CASH", cashReceived: 60 } }));
    expect(mocks.tx.transaction.create.mock.calls[0][0].data).toMatchObject({
      amount: 60,
      transactionType: "DEPOSIT",
      cashSessionId: "cs_1",
      pieceNumber: "V0042",
      changeGiven: 0,
    });
  });
});

describe("a bank transfer stays pending until staff approve it", () => {
  it("is never accepted when the sale is recorded — in full or as an acompte, even with a reference", async () => {
    for (const settlement of [
      { mode: "NOW", method: "TRANSFER", reference: "+++123/4567/89012+++" },
      { mode: "DEPOSIT", amount: 50, method: "TRANSFER", reference: "+++123/4567/89012+++" },
    ]) {
      const result = await createManualInvoice(input({ settlement }));
      expect(result).toMatchObject({ success: false, message: expect.stringContaining("Virement reçu") });
    }
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
    expect(mocks.issueInvoice).not.toHaveBeenCalled();
  });

  it("an announced transfer is recorded unpaid with the amount expected — no transaction, no invoice", async () => {
    const result = await createManualInvoice(input({ settlement: { mode: "LATER", awaitedTransferAmount: 50 } }));
    expect(result).toMatchObject({ success: true, data: { invoice: null, sale: { paidAmount: 0, remainingAmount: 174.2 } } });
    expect(mocks.tx.payment.create.mock.calls[0][0].data.awaitedTransferAmount).toBe(50);
    expect(mocks.tx.payment.create.mock.calls[0][0].data).toMatchObject({ status: "PENDING", paidAmount: 0 });
    expect(mocks.tx.transaction.create).not.toHaveBeenCalled();
    expect(mocks.issueInvoice).not.toHaveBeenCalled();
  });

  it("the amount expected never exceeds the sale; a plain « payer plus tard » expects no transfer", async () => {
    await createManualInvoice(input({ settlement: { mode: "LATER", awaitedTransferAmount: 500 } }));
    expect(mocks.tx.payment.create.mock.calls[0][0].data.awaitedTransferAmount).toBe(174.2);
    await createManualInvoice(input({ attemptKey: "attempt-key-0000000002", settlement: { mode: "LATER" } }));
    expect(mocks.tx.payment.create.mock.calls[1][0].data.awaitedTransferAmount).toBeNull();
  });

  it("« Accepter » takes one tick: the bank reference is optional, a card's terminal ticket is not", async () => {
    mocks.prisma.order.findUnique.mockResolvedValue(pendingSale());
    const accepted = await settleManualInvoice({ orderId: "o_1", method: "TRANSFER" });
    expect(accepted).toMatchObject({ success: true, data: { fullyPaid: true } });
    expect(mocks.tx.transaction.create.mock.calls[0][0].data).toMatchObject({ method: "TRANSFER", manualReference: null });

    mocks.prisma.$transaction.mockClear();
    mocks.prisma.order.findUnique.mockResolvedValue(pendingSale());
    const card = await settleManualInvoice({ orderId: "o_1", method: "CARD", reference: "" });
    expect(card).toMatchObject({ success: false, message: expect.stringContaining("ticket terminal") });
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("approving it records the transfer, clears the awaited amount and — if it clears the balance — issues the invoice", async () => {
    mocks.prisma.order.findUnique.mockResolvedValue(pendingSale());
    const result = await settleManualInvoice({ orderId: "o_1", method: "TRANSFER", reference: "+++123/4567/89012+++" });
    expect(result).toMatchObject({ success: true, data: { fullyPaid: true, invoice: { number: "F-2026-000042" } } });
    expect(mocks.tx.transaction.create.mock.calls[0][0].data).toMatchObject({
      method: "TRANSFER",
      transactionType: "FINAL_PAYMENT",
      manualReference: "+++123/4567/89012+++",
      cashSessionId: null,
    });
    expect(mocks.tx.payment.update).toHaveBeenCalledWith({ where: { id: "p_1" }, data: { awaitedTransferAmount: null } });
    expect(mocks.ensureCashSessionOpen).not.toHaveBeenCalled();
  });

  it("the till never records a transfer as paid: it announces it and says where to approve it", () => {
    const cart = source("components/dashboard/boutique/counter/CounterCart.jsx");
    expect(cart).toContain('const transferAwaited = invoiceFlow && collectsNow && method === "TRANSFER";');
    expect(cart).toContain('? { mode: "LATER", awaitedTransferAmount: settleMode === "DEPOSIT" ? depositAmount : total }');
    expect(cart).not.toContain("transferReference");
    const panel = source("components/dashboard/invoices/PendingManualSales.jsx");
    expect(panel).toContain("Virement reçu");
    expect(panel).toContain("Virement attendu");
  });
});

describe("« Encaisser » a pending sale", () => {
  const withAcompte = () => pendingSale({ payment: { id: "p_1", status: "PARTIALLY_PAID", totalAmount: "174.20", paidAmount: "50.00", invoice: null } });

  it("the payment that clears the balance issues the invoice, from what the order recorded", async () => {
    mocks.prisma.order.findUnique.mockResolvedValue(withAcompte());
    mocks.tx = makeTx({ livePayment: { status: "PARTIALLY_PAID", totalAmount: "174.20", paidAmount: "50.00" } });
    const result = await settleManualInvoice({ orderId: "o_1", method: "CARD", reference: "004512" });

    expect(result).toMatchObject({
      success: true,
      data: { fullyPaid: true, paidAmount: 174.2, remainingAmount: 0, invoice: { id: "inv_1", number: "F-2026-000042" } },
    });
    expect(result.message).toContain("F-2026-000042");
    expect(mocks.tx.payment.updateMany.mock.calls[0][0]).toMatchObject({
      where: { paidAmount: "50.00" },
      data: { status: "PAID", paidAmount: 174.2, remainingAmount: 0 },
    });
    expect(mocks.tx.transaction.create.mock.calls[0][0].data).toMatchObject({ amount: 124.2, transactionType: "FINAL_PAYMENT" });
    expect(mocks.issueInvoice).toHaveBeenCalledWith(mocks.tx, {
      paymentId: "p_1",
      source: "MANUAL",
      totalInclVat: 174.2,
      customer: expect.objectContaining({ vatNumber: "BE0417497106" }),
      lines: [
        { description: "Sérum — 50 ml", quantity: 2, unitPrice: 12.1 },
        { description: "Formation privée — 2 h", quantity: 1, unitPrice: 150 },
      ],
      vatRate: 21,
      vatTreatment: "DOMESTIC",
      taxCountryCode: "BE",
      taxNote: null,
      notes: "Merci de mentionner le numéro de facture.",
    });
    expect(mocks.tx.auditLog.create.mock.calls[0][0].data).toMatchObject({ action: "invoice.manual_settled", entityType: "Invoice", entityId: "inv_1" });
  });

  it("a further partial amount is another acompte — still no invoice", async () => {
    mocks.prisma.order.findUnique.mockResolvedValue(withAcompte());
    mocks.tx = makeTx({ livePayment: { status: "PARTIALLY_PAID", totalAmount: "174.20", paidAmount: "50.00" } });
    const result = await settleManualInvoice({ orderId: "o_1", amount: 70, method: "TRANSFER", reference: "ref" });

    expect(result).toMatchObject({ success: true, data: { fullyPaid: false, paidAmount: 120, remainingAmount: 54.2, invoice: null } });
    expect(result.message).toContain("Acompte");
    expect(mocks.tx.transaction.create.mock.calls[0][0].data).toMatchObject({ amount: 70, transactionType: "DEPOSIT" });
    expect(mocks.issueInvoice).not.toHaveBeenCalled();
    expect(mocks.tx.auditLog.create.mock.calls[0][0].data).toMatchObject({ action: "manual_sale.payment_recorded", entityType: "Order" });
  });

  it("a sale with nothing received yet is collected and invoiced in one go", async () => {
    mocks.prisma.order.findUnique.mockResolvedValue(pendingSale());
    const result = await settleManualInvoice({ orderId: "o_1", method: "TRANSFER", reference: "ref" });
    expect(result.data).toMatchObject({ fullyPaid: true, invoice: { number: "F-2026-000042" } });
    expect(mocks.tx.transaction.create.mock.calls[0][0].data).toMatchObject({ amount: 174.2, transactionType: "FINAL_PAYMENT" });
  });

  it("if the invoice is refused, the money is not recorded either — same transaction", async () => {
    mocks.prisma.order.findUnique.mockResolvedValue(pendingSale());
    mocks.issueInvoice.mockRejectedValue(Object.assign(new Error("BUYER_LEGAL_DATA_INCOMPLETE"), { userMessage: "Adresse manquante." }));
    mocks.prisma.$transaction.mockImplementation(async (fn) => fn(mocks.tx)); // a real one would roll back
    const result = await settleManualInvoice({ orderId: "o_1", method: "TRANSFER", reference: "ref" });
    expect(result).toMatchObject({ success: false, message: "Adresse manquante." });
  });

  it("a VIES validation older than 90 days is re-checked before the invoice is issued", async () => {
    const stale = { ...BELGIAN_BUYER, vatValidatedAt: new Date("2026-01-01") };
    mocks.prisma.order.findUnique.mockResolvedValue(pendingSale({ user: stale }));
    await settleManualInvoice({ orderId: "o_1", method: "TRANSFER", reference: "ref" });
    expect(mocks.saveCheckoutVatNumber).toHaveBeenCalledWith(mocks.prisma, stale, "BE0417497106");
  });

  it("a VAT number VIES now rejects blocks the final payment — nothing recorded", async () => {
    mocks.prisma.order.findUnique.mockResolvedValue(pendingSale({ user: { ...BELGIAN_BUYER, vatValidatedAt: new Date("2026-01-01") } }));
    mocks.saveCheckoutVatNumber.mockResolvedValue({ success: false, message: "Ce numéro de TVA n'est pas reconnu comme actif." });
    const result = await settleManualInvoice({ orderId: "o_1", method: "TRANSFER", reference: "ref" });
    expect(result).toMatchObject({ success: false, message: expect.stringContaining("n'est plus validé") });
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("an acompte never triggers the VIES re-check — no invoice is issued on it", async () => {
    mocks.prisma.order.findUnique.mockResolvedValue(pendingSale({ user: { ...BELGIAN_BUYER, vatValidatedAt: new Date("2026-01-01") } }));
    await settleManualInvoice({ orderId: "o_1", amount: 20, method: "TRANSFER", reference: "ref" });
    expect(mocks.saveCheckoutVatNumber).not.toHaveBeenCalled();
  });

  it("a second click that loses the race is refused — no second transaction, no second invoice", async () => {
    mocks.prisma.order.findUnique.mockResolvedValue(pendingSale());
    mocks.tx = makeTx({ claimCount: 0 });
    const result = await settleManualInvoice({ orderId: "o_1", method: "TRANSFER", reference: "ref" });
    expect(result).toMatchObject({ success: false, message: expect.stringContaining("Rechargez la page") });
    expect(mocks.tx.transaction.create).not.toHaveBeenCalled();
    expect(mocks.issueInvoice).not.toHaveBeenCalled();
  });

  it("never collects more than the balance", async () => {
    mocks.prisma.order.findUnique.mockResolvedValue(withAcompte());
    mocks.tx = makeTx({ livePayment: { status: "PARTIALLY_PAID", totalAmount: "174.20", paidAmount: "50.00" } });
    const result = await settleManualInvoice({ orderId: "o_1", amount: 124.21, method: "TRANSFER", reference: "ref" });
    expect(result).toMatchObject({ success: false, message: expect.stringContaining("solde") });
    expect(mocks.tx.payment.updateMany).not.toHaveBeenCalled();
    expect(mocks.tx.transaction.create).not.toHaveBeenCalled();
  });

  it("a sale that already has an invoice (recorded before this rule) is not invoiced twice", async () => {
    mocks.prisma.order.findUnique.mockResolvedValue(
      pendingSale({ payment: { id: "p_1", status: "PARTIALLY_PAID", totalAmount: "174.20", paidAmount: "50.00", invoice: { id: "inv_old" } } })
    );
    mocks.tx = makeTx({ livePayment: { status: "PARTIALLY_PAID", totalAmount: "174.20", paidAmount: "50.00" } });
    const result = await settleManualInvoice({ orderId: "o_1", method: "TRANSFER", reference: "ref" });
    expect(result.data).toMatchObject({ fullyPaid: true, invoice: null });
    expect(mocks.issueInvoice).not.toHaveBeenCalled();
  });

  it("refuses a non-manual, cancelled or already paid sale", async () => {
    for (const order of [
      pendingSale({ source: "POS" }),
      pendingSale({ status: "CANCELLED" }),
      pendingSale({ payment: { id: "p_1", status: "PAID", totalAmount: "174.20", paidAmount: "174.20", invoice: { id: "inv_1" } } }),
      null,
    ]) {
      mocks.prisma.order.findUnique.mockResolvedValue(order);
      expect((await settleManualInvoice({ orderId: "o_1", method: "TRANSFER", reference: "ref" })).success).toBe(false);
    }
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe("« Annuler » a pending sale", () => {
  it("only claims a manual sale with nothing received and no invoice, then puts its goods back in stock", async () => {
    const result = await cancelManualSale({ orderId: "o_1", reason: "Commande annulée par le client" });
    expect(result).toMatchObject({ success: true, message: expect.stringContaining("remis en stock") });

    expect(mocks.tx.order.updateMany.mock.calls[0][0]).toMatchObject({
      where: {
        id: "o_1",
        source: "MANUAL",
        status: "COMPLETED",
        payment: { is: { status: "PENDING", paidAmount: 0, invoice: { is: null } } },
      },
      data: { status: "CANCELLED", cancelReason: "Commande annulée par le client" },
    });
    // The catalogue line goes back; the free line has no stock.
    expect(mocks.tx.productVariant.update).toHaveBeenCalledTimes(1);
    expect(mocks.tx.productVariant.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "v1" }, data: { stockQuantity: { increment: 2 } } }));
    expect(mocks.tx.inventoryMovement.create.mock.calls[0][0].data).toMatchObject({ variantId: "v1", type: "RETURN", quantity: 2 });
    expect(mocks.tx.auditLog.create.mock.calls[0][0].data).toMatchObject({ action: "manual_sale.cancelled", entityId: "o_1" });
  });

  it("refused once anything was collected, invoiced or cancelled — nothing touched", async () => {
    mocks.tx = makeTx({ cancelClaimCount: 0 });
    const result = await cancelManualSale({ orderId: "o_1", reason: "erreur de saisie" });
    expect(result).toMatchObject({ success: false, message: expect.stringContaining("ne peut plus être annulée") });
    expect(mocks.tx.productVariant.update).not.toHaveBeenCalled();
  });

  it("a reason is required", async () => {
    expect((await cancelManualSale({ orderId: "o_1", reason: "" })).success).toBe(false);
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe("the pending list", () => {
  it("lists manual sales still owed money — the Order is the unit, not an invoice", async () => {
    mocks.prisma.order.findMany.mockResolvedValue([
      {
        id: "o_1",
        orderNumber: 77,
        createdAt: new Date(),
        paymentDueDate: null,
        invoiceNotes: null,
        customerVatNumber: "BE0417497106",
        user: { fullName: "Client SRL", email: "compta@client.be", billingProfile: null },
        items: RECORDED_SALE.items,
        payment: { totalAmount: "174.20", paidAmount: "50.00", remainingAmount: "124.20", awaitedTransferAmount: "50.00", invoice: null },
      },
    ]);
    const result = await listPendingManualSales();
    expect(mocks.prisma.order.findMany.mock.calls[0][0].where).toEqual({
      source: "MANUAL",
      status: "COMPLETED",
      payment: { is: { status: { in: ["PENDING", "PARTIALLY_PAID"] } } },
    });
    expect(result.data.rows[0]).toMatchObject({
      kind: "MANUAL_SALE",
      orderId: "o_1",
      paidAmount: 50,
      remainingAmount: 124.2,
      invoiceNumber: null,
      awaitedTransferAmount: 50,
      summary: "2 × Sérum — 50 ml, 1 × Formation privée — 2 h",
    });
    expect(result.data.stats).toEqual({ count: 1, remainingTotal: 124.2 });
  });
});

describe("idempotency", () => {
  it("a retry of a paid-in-full sale returns the invoice already issued — no second number", async () => {
    mocks.prisma.order.findUnique.mockResolvedValue({
      id: "o_1",
      orderNumber: 77,
      source: "MANUAL",
      createdByStaffId: "u_admin",
      user: { fullName: "Client SRL", billingProfile: null },
      payment: { totalAmount: "174.20", paidAmount: "174.20", remainingAmount: "0.00", invoice: ISSUED },
    });
    const result = await createManualInvoice(input());
    expect(result).toMatchObject({ success: true, data: { alreadyProcessed: true, invoice: { number: "F-2026-000042" } } });
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("a retry of a pending sale returns the sale — still no invoice", async () => {
    mocks.prisma.order.findUnique.mockResolvedValue({
      id: "o_1",
      orderNumber: 77,
      source: "MANUAL",
      createdByStaffId: "u_admin",
      user: { fullName: "Client SRL", billingProfile: null },
      payment: { totalAmount: "174.20", paidAmount: "0.00", remainingAmount: "174.20", invoice: null },
    });
    const result = await createManualInvoice(input());
    expect(result).toMatchObject({ success: true, data: { alreadyProcessed: true, invoice: null, sale: { orderNumber: 77, remainingAmount: 174.2 } } });
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("an attempt key already used by the till or by someone else is refused", async () => {
    const prior = { id: "o_1", orderNumber: 1, user: {}, payment: { totalAmount: "1", paidAmount: "1", remainingAmount: "0", invoice: ISSUED } };
    mocks.prisma.order.findUnique.mockResolvedValue({ ...prior, source: "POS", createdByStaffId: "u_admin" });
    expect((await createManualInvoice(input())).success).toBe(false);
    mocks.prisma.order.findUnique.mockResolvedValue({ ...prior, source: "MANUAL", createdByStaffId: "u_other" });
    expect((await createManualInvoice(input())).success).toBe(false);
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe("composed at la caisse", () => {
  const cart = () => source("components/dashboard/boutique/counter/CounterCart.jsx");

  it("a free line, a transfer, an acompte, « payer plus tard » or a comment routes the sale to createManualInvoice", () => {
    expect(cart()).toContain(
      'canInvoiceSale && !sourceOrder && (hasFreeLines || method === "TRANSFER" || settleMode !== "NOW" || invoiceNotes.trim() !== "")'
    );
    expect(cart()).toContain("if (invoiceFlow) return submitInvoiceSale();");
    expect(cart()).toContain("await createManualInvoice({");
  });

  it("a plain paid sale still goes through the ticket path, untouched", () => {
    expect(cart()).toContain("const result = await completePointOfSaleSale({");
  });

  it("an invoice sale can't be anonymous, opt out of its invoice, or be paid by QR", () => {
    expect(cart()).toContain("allowWalkIn={!invoiceFlow}");
    expect(cart()).toContain("showInvoiceOptOut={!invoiceFlow}");
    expect(cart()).toContain('if (invoiceFlow && method === "CARD_QR") setMethod("EXTERNAL_TERMINAL");');
  });

  it("with the till closed, only a transfer or « payer plus tard » invoice sale can be recorded", () => {
    expect(cart()).toContain('const allowedWhileClosed = invoiceFlow && (settleMode === "LATER" || method === "TRANSFER");');
    expect(cart()).toContain("(tillClosed && !allowedWhileClosed)");
  });

  it("the till lists the pending sales; « Vendre avec facture » opens the till", () => {
    expect(source("app/(dashboard)/dashboard/boutique/point-of-sale/page.jsx")).toContain("listPendingManualSales()");
    expect(source("components/dashboard/boutique/counter/CounterSurface.jsx")).toContain("<PendingManualSales data={pendingManualSales} />");
    expect(source("app/dashboard/factures/page.jsx")).toContain('href="/dashboard/boutique/point-of-sale#counter-cart"');
  });
});

describe("wiring", () => {
  it("the validation schema stays out of the 'use server' module", () => {
    const action = source("actions/invoices/manual-invoice.js");
    expect(action.startsWith('"use server";')).toBe(true);
    expect(action).not.toMatch(/export const /);
  });

  it("the order-expiry job can never reach a manual sale's order", () => {
    expect(source("lib/orders/expire-stale-orders.js")).toContain('source: { not: "MANUAL" }');
  });

  it("an invoice PDF never prints an acompte: a manual invoice is only ever issued paid", () => {
    expect(source("lib/pdf/InvoiceDocument.jsx")).not.toContain("Acompte reçu");
    expect(source("lib/peppyrus/build-ubl.js")).toContain("prepaidAmount: 0,");
  });

  it("a bank transfer is its own revenue method, on the bank side of the reports", async () => {
    const { RECETTES_METHODS } = await import("@/lib/livre-de-recettes/filters");
    const { BANK_METHODS, METHOD_LABELS } = await import("@/lib/reports-filters");
    expect(RECETTES_METHODS).toContain("TRANSFER");
    expect(BANK_METHODS).toContain("TRANSFER");
    expect(METHOD_LABELS.TRANSFER).toBe("Virement bancaire");
  });

  it("a transfer refund is manual and needs its bank reference", async () => {
    const { validateManualRefundConfirmation, refundMethodLabel } = await import("@/lib/payments/refund-method");
    const { planRefund } = await import("@/lib/refunds/plan-refund");
    expect(refundMethodLabel("TRANSFER")).toBe("Virement bancaire");
    expect(validateManualRefundConfirmation({ method: "TRANSFER", confirmed: true, reference: "" })).toMatch(/virement/);
    expect(validateManualRefundConfirmation({ method: "TRANSFER", confirmed: true, reference: "ref" })).toBeNull();

    const plan = planRefund({
      transactions: [{ id: "t", method: "TRANSFER", transactionType: "FINAL_PAYMENT", amount: 50, paidAt: new Date() }],
    });
    expect(plan).toMatchObject({ automaticTotal: 0, manualTotal: 50, requiresManualConfirmation: true });
  });
});
