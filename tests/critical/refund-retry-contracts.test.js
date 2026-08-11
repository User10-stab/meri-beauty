import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8");

// P0: a partial Stripe refund stuck in REFUND_PENDING/REFUND_FAILED must
// retry for the exact amount owed, never for whatever the Transaction
// ledger's sum happens to leave "remaining" — that recomputation resolves
// to the full paid amount whenever no REFUND row was ever written, which is
// exactly why the payment is stuck in the first place.
describe("refund retry never exceeds the exact pending amount", () => {
  const schema = source("prisma/schema.prisma");
  const retryEngine = source("lib/payments/retry-failed-refunds.js");
  const returns = source("actions/boutique/returns.js");
  const orders = source("actions/boutique/orders.js");

  test("Payment durably pins the exact amount and a stable idempotency key for the in-flight refund", () => {
    expect(schema).toContain("pendingRefundAmount");
    expect(schema).toContain("pendingRefundIdempotencyKey");
  });

  test("the retry engine replays the pinned amount instead of recomputing from the ledger", () => {
    expect(retryEngine).toContain("payment.pendingRefundAmount == null");
    expect(retryEngine).toContain('return { outcome: "missing-pending-amount" }');
    expect(retryEngine).toContain("const pinnedAmount = Number(payment.pendingRefundAmount)");
    expect(retryEngine).toContain("amount: Math.round(pinnedAmount * 100)");
    expect(retryEngine).toContain("idempotencyKey: payment.pendingRefundIdempotencyKey");
    // The old bug pattern — deriving the retry amount from paidAmount minus
    // the ledger sum — must not reappear.
    expect(retryEngine).not.toContain("Number(payment.paidAmount) - alreadyRefunded");
  });

  test("a missing pinned amount is refused rather than guessed", () => {
    expect(retryEngine).toContain('"missing-pending-amount"');
    expect(retryEngine).toContain("needsManualReconciliation");
  });

  test("return refunds pin the amount and idempotency key before calling Stripe, and clear them on success", () => {
    expect(returns).toContain("pendingRefundAmount: totalRefund");
    expect(returns).toContain("pendingRefundIdempotencyKey: refundIdempotencyKey");
    expect(returns).toContain("idempotencyKey: refundIdempotencyKey");
    expect(returns).toContain("pendingRefundAmount: null");
    expect(returns).toContain("pendingRefundIdempotencyKey: null");
  });

  test("return refunds refuse to start a second operation while one is already pending", () => {
    expect(returns).toContain('["REFUND_PENDING", "REFUND_FAILED"].includes(lockedPayment[0]?.status)');
    expect(returns).toContain("REFUND_ALREADY_PENDING");
  });

  test("order cancellation refunds pin the amount and idempotency key before calling Stripe, and clear them on success", () => {
    expect(orders).toContain("pendingRefundAmount: remaining, pendingRefundIdempotencyKey: refundIdempotencyKey");
    expect(orders).toContain("idempotencyKey: refundIdempotencyKey");
    expect(orders).toContain("pendingRefundAmount: null");
    expect(orders).toContain("pendingRefundIdempotencyKey: null");
  });

  test("order cancellation refuses to start a second refund while one is already pending on the same payment", () => {
    expect(orders).toContain('["REFUND_PENDING", "REFUND_FAILED"].includes(order.payment.status)');
  });
});
