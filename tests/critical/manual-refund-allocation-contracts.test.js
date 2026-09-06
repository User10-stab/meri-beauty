import { describe, expect, it, vi } from "vitest";
import { queueManualRefund } from "@/lib/refunds/queue-manual-refund";

const onlineDeposit = {
  id: "deposit-40",
  amount: 40,
  method: "ONLINE",
  transactionType: "DEPOSIT",
  paidAt: new Date("2026-09-01T10:00:00Z"),
  isDeleted: false,
  stripePaymentIntentId: "pi_40",
  stripeCheckoutSessionId: "cs_40",
};

describe("manual refund allocation", () => {
  it("refuses a partial plan before it can create an underfunded refund operation", async () => {
    const create = vi.fn();
    const tx = {
      refundOperation: { findFirst: vi.fn().mockResolvedValue(null), create },
      cashSession: { findFirst: vi.fn() },
      auditLog: { create: vi.fn() },
    };

    await expect(
      queueManualRefund(tx, {
        paymentId: "payment-1",
        source: "WORKSHOP",
        trigger: "SALON_CANCELLATION",
        reason: "Exception validée",
        amount: 60,
        transactions: [onlineDeposit],
      }),
    ).rejects.toThrow("REFUND_ALLOCATION_INCOMPLETE");

    expect(create).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });
});
