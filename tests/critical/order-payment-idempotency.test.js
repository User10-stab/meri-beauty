import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    payment: { findFirst: vi.fn() },
    order: { findUnique: vi.fn() },
    $transaction: vi.fn(),
  },
  stripe: { refunds: { create: vi.fn() } },
  captureCriticalError: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/stripe", () => ({ stripe: mocks.stripe }));
vi.mock("@/lib/email", () => ({ sendEmail: vi.fn() }));
vi.mock("@/lib/invoicing", () => ({ issueInvoice: vi.fn(), buildInvoiceCustomer: vi.fn() }));
vi.mock("@/lib/pdf/render", () => ({ renderInvoicePdf: vi.fn() }));
vi.mock("@/lib/monitoring", () => ({
  captureCriticalError: mocks.captureCriticalError,
  captureWarning: vi.fn(),
}));

import { fulfillOrderPayment } from "@/lib/orders/fulfill-order-payment";

const session = {
  id: "cs_test_duplicate",
  payment_intent: "pi_test_duplicate",
  amount_total: 2595,
  metadata: { kind: "order", orderId: "order_100" },
};

function pendingOrder() {
  return {
    id: "order_100",
    status: "PENDING_PAYMENT",
    source: "ONLINE",
    fulfilmentMode: "PICKUP_PREPAID",
    totalAmount: 25.95,
    items: [],
    cart: null,
    user: { id: "customer_1", email: "customer@example.com", fullName: "Customer" },
  };
}

beforeEach(() => {
  mocks.prisma.$transaction.mockImplementation(async (callback) => callback({
    order: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
  }));
  mocks.stripe.refunds.create.mockResolvedValue({ id: "re_test" });
});

describe("order payment finalization idempotency", () => {
  it("does not refund when another processor completed the same Stripe session", async () => {
    mocks.prisma.payment.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "payment_winner" });
    mocks.prisma.order.findUnique.mockResolvedValueOnce(pendingOrder());

    const result = await fulfillOrderPayment(session);

    expect(result).toEqual({ received: true, alreadyProcessed: true });
    expect(mocks.stripe.refunds.create).not.toHaveBeenCalled();
  });

  it("refunds a genuinely cancelled order with a stable idempotency key", async () => {
    mocks.prisma.payment.findFirst.mockResolvedValue(null);
    mocks.prisma.order.findUnique
      .mockResolvedValueOnce(pendingOrder())
      .mockResolvedValueOnce({ status: "CANCELLED" });

    const result = await fulfillOrderPayment(session);

    expect(result).toMatchObject({ received: true, refunded: true });
    expect(mocks.stripe.refunds.create).toHaveBeenCalledWith(
      expect.objectContaining({
        payment_intent: "pi_test_duplicate",
        metadata: expect.objectContaining({
          kind: "order_auto_refund",
          orderId: "order_100",
          reason: "order-cancelled-during-payment",
        }),
      }),
      { idempotencyKey: "order-auto-refund:order-cancelled-during-payment:cs_test_duplicate" }
    );
  });

  it("fails safely instead of refunding an unexplained non-pending order", async () => {
    mocks.prisma.payment.findFirst.mockResolvedValue(null);
    mocks.prisma.order.findUnique
      .mockResolvedValueOnce(pendingOrder())
      .mockResolvedValueOnce({ status: "PAID" });

    await expect(fulfillOrderPayment(session)).rejects.toThrow("ORDER_NO_LONGER_PENDING");
    expect(mocks.stripe.refunds.create).not.toHaveBeenCalled();
    expect(mocks.captureCriticalError).toHaveBeenCalledOnce();
  });
});
