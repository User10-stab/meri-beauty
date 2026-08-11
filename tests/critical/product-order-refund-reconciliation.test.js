import { describe, expect, it, vi } from "vitest";
import { reconcileStripeProductOrderRefund } from "@/lib/orders/reconcile-stripe-refund";

function transactionMock({ orderStatus = "PAID", refunds = [] } = {}) {
  const tx = {
    $executeRaw: vi.fn().mockResolvedValue(0),
    payment: {
      findUnique: vi.fn().mockResolvedValue({
        id: "pay_1",
        paidAmount: 21,
        transactions: [
          { transactionType: "FINAL_PAYMENT", amount: 21 },
          ...refunds.map((amount) => ({ transactionType: "REFUND", amount })),
        ],
        order: {
          id: "order_1",
          orderNumber: 83,
          status: orderStatus,
          items: [{ variantId: "variant_1", quantity: 2 }],
        },
      }),
      update: vi.fn().mockResolvedValue({}),
    },
    transaction: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      create: vi.fn().mockResolvedValue({ id: "transaction_refund" }),
    },
    order: {
      updateMany: vi.fn().mockResolvedValue({ count: orderStatus === "CANCELLED" ? 0 : 1 }),
    },
    productVariant: {
      update: vi.fn().mockResolvedValue({ stockQuantity: 5, reservedQuantity: 0 }),
    },
    inventoryMovement: { create: vi.fn().mockResolvedValue({}) },
  };
  return tx;
}

describe("product-order Stripe refund reconciliation", () => {
  it("cancels and restocks a fully refunded paid order", async () => {
    const tx = transactionMock();
    const result = await reconcileStripeProductOrderRefund(tx, {
      paymentId: "pay_1",
      stripeRefundedTotal: 21,
      stripePaymentIntentId: "pi_1",
      stripeRefundId: "re_1",
    });

    expect(result).toMatchObject({ handled: true, fullyRefunded: true, orderCancelled: true });
    expect(tx.order.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: "order_1" }),
      data: expect.objectContaining({ status: "CANCELLED" }),
    }));
    expect(tx.productVariant.update).toHaveBeenCalledWith({
      where: { id: "variant_1" },
      data: { stockQuantity: { increment: 2 } },
    });
    expect(tx.inventoryMovement.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ type: "RETURN", quantity: 2, previousStock: 3, newStock: 5 }),
    });
    expect(tx.transaction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ stripePaymentIntentId: "pi_1", transactionType: "REFUND" }),
    });
  });

  it("does not restock or duplicate a refund on repeated delivery", async () => {
    const tx = transactionMock({ orderStatus: "CANCELLED", refunds: [21] });
    const result = await reconcileStripeProductOrderRefund(tx, {
      paymentId: "pay_1",
      stripeRefundedTotal: 21,
      stripePaymentIntentId: "pi_1",
    });

    expect(result).toMatchObject({ alreadyProcessed: true, orderCancelled: false });
    expect(tx.transaction.create).not.toHaveBeenCalled();
    expect(tx.productVariant.update).not.toHaveBeenCalled();
    expect(tx.inventoryMovement.create).not.toHaveBeenCalled();
  });

  it("records a partial refund without cancelling or changing inventory", async () => {
    const tx = transactionMock();
    const result = await reconcileStripeProductOrderRefund(tx, {
      paymentId: "pay_1",
      stripeRefundedTotal: 5,
      stripePaymentIntentId: "pi_1",
    });

    expect(result).toMatchObject({ fullyRefunded: false, newlyRefunded: 5, orderCancelled: false });
    expect(tx.payment.update).toHaveBeenCalledWith({
      where: { id: "pay_1" },
      data: { status: "PARTIALLY_REFUNDED" },
    });
    expect(tx.order.updateMany).not.toHaveBeenCalled();
    expect(tx.productVariant.update).not.toHaveBeenCalled();
  });

  it("serializes reconciliation and backfills the original PaymentIntent id", async () => {
    const tx = transactionMock();
    await reconcileStripeProductOrderRefund(tx, {
      paymentId: "pay_1",
      stripeRefundedTotal: 21,
      stripePaymentIntentId: "pi_1",
    });

    expect(tx.$executeRaw).toHaveBeenCalledOnce();
    expect(tx.transaction.updateMany).toHaveBeenCalledWith({
      where: {
        paymentId: "pay_1",
        transactionType: { in: ["DEPOSIT", "FINAL_PAYMENT"] },
        stripePaymentIntentId: null,
      },
      data: { stripePaymentIntentId: "pi_1" },
    });
  });
});
