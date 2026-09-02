import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The settlement guarantees the handoff spends most of its "e-mails et
 * webhook Stripe" section on:
 *
 *   - a leg becomes SUCCEEDED only when money actually moved;
 *   - a webhook delivered twice settles once;
 *   - the customer is mailed exactly once, and only after EVERY leg landed;
 *   - a CARD leg cannot settle without its terminal ticket reference;
 *   - a CASH leg cannot settle without a confirmed hand-over.
 */

const mocks = vi.hoisted(() => {
  const tx = {
    $executeRaw: vi.fn(),
    refundLeg: { findUnique: vi.fn(), update: vi.fn(), findMany: vi.fn() },
    refundOperation: { update: vi.fn() },
    transaction: { create: vi.fn() },
    payment: { findUnique: vi.fn(), update: vi.fn() },
    auditLog: { create: vi.fn() },
  };
  return {
    tx,
    prisma: {
      $transaction: vi.fn(async (fn) => fn(tx)),
      refundOperation: { findUnique: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
      refundLeg: { findFirst: vi.fn() },
    },
    sendEmail: vi.fn(async () => ({ success: true })),
    renderCreditNotePdf: vi.fn(async () => Buffer.from("pdf")),
  };
});

vi.mock("@/lib/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/email", () => ({ sendEmail: mocks.sendEmail }));
vi.mock("@/lib/pdf/render", () => ({ renderCreditNotePdf: mocks.renderCreditNotePdf }));
vi.mock("@/lib/email-templates", () => ({
  brandedHtml: (title, body) => `<html>${title}${body}</html>`,
  escapeHtml: (value) => String(value),
}));
vi.mock("@prisma/client", () => ({ Prisma: { sql: (strings, ...values) => ({ strings, values }) } }));

import { settleRefundLeg } from "@/lib/refunds/settle-leg";
import { notifyRefundComplete } from "@/lib/refunds/notify-refund-complete";

function leg(overrides = {}) {
  return {
    id: "leg-1",
    refundOperationId: "op-1",
    method: "ONLINE",
    amount: 10.5,
    status: "PENDING",
    cashSessionId: null,
    pieceNumber: null,
    stripeRefundId: null,
    stripePaymentIntentId: "pi_1",
    terminalReference: null,
    cashHandedOver: false,
    sourceTransaction: { stripeCheckoutSessionId: "cs_1" },
    refundOperation: { id: "op-1", paymentId: "pay-1", creditNoteId: "cn-1", source: "WORKSHOP" },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.tx.transaction.create.mockResolvedValue({ id: "tx-refund-1" });
  mocks.tx.refundLeg.update.mockResolvedValue({});
  mocks.tx.refundLeg.findMany.mockResolvedValue([{ status: "SUCCEEDED" }]);
  mocks.tx.refundOperation.update.mockResolvedValue({});
  mocks.tx.payment.findUnique.mockResolvedValue({
    paidAmount: 10.5,
    transactions: [{ amount: 10.5, transactionType: "REFUND" }],
  });
  mocks.tx.payment.update.mockResolvedValue({});
  mocks.tx.auditLog.create.mockResolvedValue({});
  mocks.sendEmail.mockResolvedValue({ success: true });
});

describe("settleRefundLeg", () => {
  it("writes the REFUND transaction and links it to the operation's credit note", async () => {
    mocks.tx.refundLeg.findUnique
      .mockResolvedValueOnce({ refundOperationId: "op-1" })
      .mockResolvedValueOnce(leg());

    const result = await settleRefundLeg({
      prisma: mocks.prisma,
      legId: "leg-1",
      stripe: { refundId: "re_1", paymentIntentId: "pi_1" },
    });

    expect(result.settled).toBe(true);
    expect(mocks.tx.transaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          paymentId: "pay-1",
          transactionType: "REFUND",
          method: "ONLINE",
          // Several refund rows may point at one note — the whole reason
          // the unique constraint was dropped.
          creditNoteId: "cn-1",
        }),
      }),
    );
    expect(mocks.tx.refundLeg.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "SUCCEEDED", refundTransactionId: "tx-refund-1" }) }),
    );
  });

  it("is a no-op the second time a webhook delivers the same refund", async () => {
    mocks.tx.refundLeg.findUnique
      .mockResolvedValueOnce({ refundOperationId: "op-1" })
      .mockResolvedValueOnce(leg({ status: "SUCCEEDED" }));

    const result = await settleRefundLeg({ prisma: mocks.prisma, legId: "leg-1", stripe: { refundId: "re_1" } });

    expect(result).toMatchObject({ settled: false, reason: "ALREADY_SETTLED" });
    // The critical assertion: no second ledger row for one movement of money.
    expect(mocks.tx.transaction.create).not.toHaveBeenCalled();
  });

  it("refuses a CARD leg with no terminal ticket reference", async () => {
    mocks.tx.refundLeg.findUnique
      .mockResolvedValueOnce({ refundOperationId: "op-1" })
      .mockResolvedValueOnce(leg({ method: "CARD", status: "MANUAL_CONFIRMATION_REQUIRED" }));

    const result = await settleRefundLeg({
      prisma: mocks.prisma,
      legId: "leg-1",
      manual: { confirmedByUserId: "u1", terminalReference: "  " },
    });

    expect(result).toMatchObject({ settled: false, reason: "TERMINAL_REFERENCE_REQUIRED" });
    expect(mocks.tx.transaction.create).not.toHaveBeenCalled();
  });

  it("refuses a CASH leg until the hand-over is confirmed", async () => {
    mocks.tx.refundLeg.findUnique
      .mockResolvedValueOnce({ refundOperationId: "op-1" })
      .mockResolvedValueOnce(leg({ method: "CASH", status: "MANUAL_CONFIRMATION_REQUIRED" }));

    const result = await settleRefundLeg({
      prisma: mocks.prisma,
      legId: "leg-1",
      manual: { confirmedByUserId: "u1", cashHandedOver: false },
    });

    expect(result).toMatchObject({ settled: false, reason: "CASH_HANDOVER_NOT_CONFIRMED" });
  });

  it("carries the cash-book piece number onto the ledger row", async () => {
    mocks.tx.refundLeg.findUnique
      .mockResolvedValueOnce({ refundOperationId: "op-1" })
      .mockResolvedValueOnce(
        leg({ method: "CASH", status: "MANUAL_CONFIRMATION_REQUIRED", pieceNumber: "A0007", cashSessionId: "cs-open" }),
      );

    await settleRefundLeg({
      prisma: mocks.prisma,
      legId: "leg-1",
      manual: { confirmedByUserId: "u1", cashHandedOver: true },
    });

    expect(mocks.tx.transaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ pieceNumber: "A0007", cashSessionId: "cs-open" }),
      }),
    );
  });

  it("marks the operation PARTIALLY_REFUNDED while a leg is still outstanding", async () => {
    mocks.tx.refundLeg.findUnique
      .mockResolvedValueOnce({ refundOperationId: "op-1" })
      .mockResolvedValueOnce(leg());
    mocks.tx.refundLeg.findMany.mockResolvedValue([
      { status: "SUCCEEDED" },
      { status: "MANUAL_CONFIRMATION_REQUIRED" },
    ]);

    const result = await settleRefundLeg({ prisma: mocks.prisma, legId: "leg-1", stripe: { refundId: "re_1" } });

    expect(result.operationStatus).toBe("PARTIALLY_REFUNDED");
  });
});

function operation(overrides = {}) {
  return {
    id: "op-1",
    customerNotifiedAt: null,
    refundReceiptNumber: null,
    creditNote: null,
    invoice: null,
    legs: [{ method: "ONLINE", amount: 10.5, status: "SUCCEEDED" }],
    payment: {
      workshopReservation: {
        session: { workshop: { title: "Atelier maquillage" } },
        customer: { fullName: "Alice", email: "alice@example.com" },
      },
    },
    ...overrides,
  };
}

describe("notifyRefundComplete", () => {
  it("says nothing while a manual leg is still outstanding", async () => {
    mocks.prisma.refundOperation.findUnique.mockResolvedValue(
      operation({
        legs: [
          { method: "ONLINE", amount: 10.5, status: "SUCCEEDED" },
          { method: "CASH", amount: 10.5, status: "MANUAL_CONFIRMATION_REQUIRED" },
        ],
      }),
    );

    const result = await notifyRefundComplete({ prisma: mocks.prisma, operationId: "op-1" });

    expect(result).toMatchObject({ sent: false, reason: "LEGS_OUTSTANDING" });
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it("sends once every leg has landed, listing each method", async () => {
    mocks.prisma.refundOperation.findUnique.mockResolvedValue(
      operation({
        legs: [
          { method: "ONLINE", amount: 10.5, status: "SUCCEEDED" },
          { method: "CASH", amount: 10.5, status: "SUCCEEDED" },
        ],
      }),
    );
    mocks.prisma.refundOperation.updateMany.mockResolvedValue({ count: 1 });

    const result = await notifyRefundComplete({ prisma: mocks.prisma, operationId: "op-1" });

    expect(result.sent).toBe(true);
    const mail = mocks.sendEmail.mock.calls[0][0];
    expect(mail.to).toBe("alice@example.com");
    expect(mail.text).toContain("21,00");
    expect(mail.text).toContain("espèces");
    expect(mail.text).toContain("carte bancaire (en ligne)");
    // The indicative bank delay belongs only to the card half.
    expect(mail.text).toContain("5 à 10 jours ouvrables");
  });

  it("claims customerNotifiedAt before sending, so a redelivered webhook cannot mail twice", async () => {
    mocks.prisma.refundOperation.findUnique.mockResolvedValue(operation());
    // Second delivery: the conditional update matches nothing.
    mocks.prisma.refundOperation.updateMany.mockResolvedValue({ count: 0 });

    const result = await notifyRefundComplete({ prisma: mocks.prisma, operationId: "op-1" });

    expect(result).toMatchObject({ sent: false, reason: "ALREADY_NOTIFIED" });
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it("refuses immediately when the operation was already notified", async () => {
    mocks.prisma.refundOperation.findUnique.mockResolvedValue(
      operation({ customerNotifiedAt: new Date("2026-09-02T10:00:00Z") }),
    );

    const result = await notifyRefundComplete({ prisma: mocks.prisma, operationId: "op-1" });

    expect(result).toMatchObject({ sent: false, reason: "ALREADY_NOTIFIED" });
    expect(mocks.prisma.refundOperation.updateMany).not.toHaveBeenCalled();
  });

  it("releases the claim when the provider fails, so the customer is not silently skipped", async () => {
    mocks.prisma.refundOperation.findUnique.mockResolvedValue(operation());
    mocks.prisma.refundOperation.updateMany.mockResolvedValue({ count: 1 });
    mocks.sendEmail.mockResolvedValue({ success: false, error: "smtp down" });

    const result = await notifyRefundComplete({ prisma: mocks.prisma, operationId: "op-1" });

    expect(result).toMatchObject({ sent: false, reason: "EMAIL_PROVIDER_FAILED" });
    expect(mocks.prisma.refundOperation.update).toHaveBeenCalledWith({
      where: { id: "op-1" },
      data: { customerNotifiedAt: null },
    });
  });

  it("names the B2C refund receipt when there is no invoice to credit", async () => {
    mocks.prisma.refundOperation.findUnique.mockResolvedValue(
      operation({ refundReceiptNumber: "RB2026-000004" }),
    );
    mocks.prisma.refundOperation.updateMany.mockResolvedValue({ count: 1 });

    await notifyRefundComplete({ prisma: mocks.prisma, operationId: "op-1" });

    expect(mocks.sendEmail.mock.calls[0][0].text).toContain("RB2026-000004");
    expect(mocks.renderCreditNotePdf).not.toHaveBeenCalled();
  });
});
