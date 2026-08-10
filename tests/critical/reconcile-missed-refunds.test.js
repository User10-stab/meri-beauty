import { describe, expect, test, vi } from "vitest";
import { reconcileMissedRefunds } from "../../lib/payments/reconcile-missed-refunds.js";

function stripeMock({ refunds = [], charge = null, sessions = [] } = {}) {
  return {
    refunds: {
      list: vi.fn().mockResolvedValue({ data: refunds, has_more: false }),
    },
    charges: {
      retrieve: vi.fn().mockResolvedValue(charge),
    },
    checkout: {
      sessions: { list: vi.fn().mockResolvedValue({ data: sessions }) },
    },
  };
}

function orderPayment({ recordedRefund = 0 } = {}) {
  return {
    id: "pay_1",
    orderId: "order_1",
    paidAmount: 21,
    invoice: null,
    transactions: recordedRefund ? [{ transactionType: "REFUND", amount: recordedRefund }] : [],
    order: { id: "order_1", orderNumber: 83, status: "PAID", items: [{ variantId: "variant_1", quantity: 2 }] },
    workshopReservation: null,
    formationReservation: null,
  };
}

function prismaMock({ linkedPaymentId = "pay_1", payment }) {
  const txStub = {
    $executeRaw: vi.fn().mockResolvedValue(0),
    payment: {
      findUnique: vi.fn().mockResolvedValue(payment),
      update: vi.fn().mockResolvedValue({}),
    },
    transaction: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      create: vi.fn().mockResolvedValue({ id: "tx_refund" }),
    },
    order: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    productVariant: { update: vi.fn().mockResolvedValue({ stockQuantity: 5 }) },
    inventoryMovement: { create: vi.fn().mockResolvedValue({}) },
  };
  return {
    transaction: { findFirst: vi.fn().mockResolvedValue(linkedPaymentId ? { paymentId: linkedPaymentId } : null) },
    payment: { findUnique: vi.fn().mockResolvedValue(payment) },
    $transaction: vi.fn().mockImplementation((cb) => cb(txStub)),
    __txStub: txStub,
  };
}

describe("reconcileMissedRefunds", () => {
  test("recovers a refund that never reached the webhook", async () => {
    const payment = orderPayment();
    const stripeClient = stripeMock({
      refunds: [{ id: "re_1", status: "succeeded", charge: "ch_1", created: 1_700_000_000 }],
      charge: { id: "ch_1", amount_refunded: 2100, payment_intent: "pi_1", refunds: { data: [{ id: "re_1" }] } },
    });
    const prismaClient = prismaMock({ payment });

    const result = await reconcileMissedRefunds({ stripeClient, prismaClient });

    expect(result).toMatchObject({ checked: 1, reconciled: 1, failures: [] });
    expect(prismaClient.$transaction).toHaveBeenCalledOnce();
    expect(prismaClient.__txStub.order.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "CANCELLED" }) }),
    );
  });

  test("is a no-op once the webhook has already recorded the full amount", async () => {
    const payment = orderPayment({ recordedRefund: 21 });
    const stripeClient = stripeMock({
      refunds: [{ id: "re_1", status: "succeeded", charge: "ch_1", created: 1_700_000_000 }],
      charge: { id: "ch_1", amount_refunded: 2100, payment_intent: "pi_1", refunds: { data: [{ id: "re_1" }] } },
    });
    const prismaClient = prismaMock({ payment });

    const result = await reconcileMissedRefunds({ stripeClient, prismaClient });

    expect(result).toMatchObject({ checked: 1, reconciled: 0 });
    expect(prismaClient.$transaction).not.toHaveBeenCalled();
  });

  test("skips a refund whose PaymentIntent matches nothing of ours", async () => {
    const stripeClient = stripeMock({
      refunds: [{ id: "re_1", status: "succeeded", charge: "ch_1", created: 1_700_000_000 }],
      charge: { id: "ch_1", amount_refunded: 500, payment_intent: "pi_unknown", refunds: { data: [] } },
      sessions: [],
    });
    const prismaClient = prismaMock({ linkedPaymentId: null, payment: null });
    prismaClient.payment.findUnique.mockResolvedValue(null);

    const result = await reconcileMissedRefunds({ stripeClient, prismaClient });

    expect(result).toMatchObject({ checked: 1, reconciled: 0, failures: [] });
    expect(prismaClient.$transaction).not.toHaveBeenCalled();
  });

  test("ignores refunds outside the lookback window's charge dedupe (same charge listed twice)", async () => {
    const payment = orderPayment({ recordedRefund: 21 });
    const stripeClient = stripeMock({
      refunds: [
        { id: "re_1", status: "succeeded", charge: "ch_1", created: 1_700_000_000 },
        { id: "re_2", status: "succeeded", charge: "ch_1", created: 1_700_000_100 },
      ],
      charge: { id: "ch_1", amount_refunded: 2100, payment_intent: "pi_1", refunds: { data: [{ id: "re_1" }, { id: "re_2" }] } },
    });
    const prismaClient = prismaMock({ payment });

    const result = await reconcileMissedRefunds({ stripeClient, prismaClient });

    expect(result.checked).toBe(1); // deduped by charge id, not re-fetched twice
    expect(stripeClient.charges.retrieve).toHaveBeenCalledOnce();
  });
});
