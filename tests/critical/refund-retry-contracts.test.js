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
    expect(orders).toContain("pendingRefundAmount: remaining,");
    expect(orders).toContain("pendingRefundIdempotencyKey: refundIdempotencyKey,");
    expect(orders).toContain("idempotencyKey: refundIdempotencyKey");
    expect(orders).toContain("pendingRefundAmount: null");
    expect(orders).toContain("pendingRefundIdempotencyKey: null");
  });

  test("order cancellation refuses to start a second refund while one is already pending on the same payment", () => {
    expect(orders).toContain('["REFUND_PENDING", "REFUND_FAILED"].includes(order.payment.status)');
  });
});

// P0: the 4 reservation-side cancellation paths (staff appointment reject,
// customer appointment cancel, workshop cancel, formation cancel) used to
// skip this pinning entirely — 3 of them set REFUND_PENDING with no amount
// (unretryable), and the customer-initiated path wrote nothing at all on
// failure (invisible to both the retry cron and the reconciliation
// dashboard). All 4 now share lib/payments/pin-pending-refund.js instead of
// reimplementing the boutique pattern a 4th and 5th time.
describe("reservation cancellations pin refunds the same way boutique orders/returns do", () => {
  const helper = source("lib/payments/pin-pending-refund.js");
  const rejectAppointment = source("actions/appointment/manage-appointment.js");
  const cancelReservation = source("actions/reservation/cancel-reservation.js");
  const cancelWorkshop = source("actions/workshops/manage-reservation.js");
  const cancelFormation = source("actions/formations/manage-reservation.js");

  test("the shared helper pins before Stripe and leaves the pin intact on failure", () => {
    expect(helper).toContain('status: "REFUND_PENDING"');
    expect(helper).toContain("pendingRefundAmount: amount");
    expect(helper).toContain("pendingRefundIdempotencyKey: idempotencyKey");
    expect(helper).toContain('status: "REFUND_FAILED"');
    expect(helper).toContain("refundRetryCount: { increment: 1 }");
    // markRefundFailed must NOT null out the pending fields — the whole
    // point is the retry job can still find them afterward.
    const failedFn = helper.slice(
      helper.indexOf("export function markRefundFailed"),
      helper.indexOf("export function clearPendingRefund")
    );
    expect(failedFn).not.toContain("pendingRefundAmount: null");
  });

  // Only the paths that still refund automatically. As each one is
  // converted to queueManualRefund it moves to the block below instead —
  // see tests/critical/refunds-are-manual-contracts.test.js for the policy
  // this is being migrated towards.
  for (const [name, mod] of [
    ["rejectAppointment (staff/admin)", rejectAppointment],
    ["cancelReservation (customer)", cancelReservation],
  ]) {
    test(`${name} pins the refund and passes an idempotency key to Stripe`, () => {
      expect(mod).toContain("pinPendingRefund(tx");
      expect(mod).toContain("buildRefundIdempotencyKey");
      expect(mod).toContain("idempotencyKey: refundIdempotencyKey");
      expect(mod).toContain("markRefundFailed(prisma");
    });
  }

  // Converted 2026-09-02: an admin now refunds this by hand in Stripe, so
  // there is no call to pin, no key to replay and nothing for the retry
  // cron to pick up. The money is recorded as owed instead of being sent.
  for (const [name, mod] of [
    ["cancelWorkshopReservation", cancelWorkshop],
    ["cancelFormationReservation", cancelFormation],
  ]) {
    test(`${name} no longer pins or retries anything`, () => {
      expect(mod).not.toContain("refunds.create");
      expect(mod).not.toContain("pinPendingRefund");
      expect(mod).not.toContain("markRefundFailed");
      expect(mod).toContain("queueManualRefund(tx");
      expect(mod).toContain("issueCreditNote(tx");
    });
  }

  // The atelier cancellation e-mail takes a `refunded` flag; the formation
  // one has no such wording at all. Only the former can get this wrong.
  test("the atelier cancellation e-mail no longer claims a refund happened", () => {
    expect(cancelWorkshop).toContain("refunded: false");
  });

  test("cancelReservation (customer path) no longer silently drops a failed refund", () => {
    // The old bug: a bare console.error with no durable Payment write at all.
    expect(cancelReservation).toContain("await markRefundFailed(prisma, payment.id, err)");
  });
});
