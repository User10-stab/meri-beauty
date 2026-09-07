import { describe, expect, test } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8");

// A failed legacy Stripe call keeps its original amount as audit data, but
// it must never be replayed automatically or by an old dashboard button.
describe("failed refunds require a fresh explicit admin action", () => {
  const schema = source("prisma/schema.prisma");
  const returns = source("actions/boutique/returns.js");
  const orders = source("actions/boutique/orders.js");

  test("Payment durably pins the exact amount and a stable idempotency key for the in-flight refund", () => {
    expect(schema).toContain("pendingRefundAmount");
    expect(schema).toContain("pendingRefundIdempotencyKey");
  });

  test("the legacy automatic retry engine is deleted", () => {
    expect(existsSync(`${root}lib/payments/retry-failed-refunds.js`)).toBe(false);
    expect(source("lib/background-jobs.js")).not.toContain("retryFailedRefunds");
    expect(source("app/api/cron/route.js")).not.toContain("retryFailedRefunds");
    expect(source("actions/dashboard/webhook-recovery.js")).not.toContain("retryStuckPayment");
  });

  // Converted 2026-09-03: an admin now refunds an ONLINE return by hand in
  // Stripe, so there is nothing here to pin or retry — the CASH/CARD branch
  // (manualRefund) is untouched, since it already never called Stripe.
  test("return refunds no longer pin or call Stripe for the ONLINE case", () => {
    expect(returns).not.toContain("refunds.create");
    expect(returns).not.toContain("pendingRefundAmount: totalRefund");
    expect(returns).not.toContain("pendingRefundIdempotencyKey: refundIdempotencyKey");
    expect(returns).toContain("queueManualRefund(tx");
    expect(returns).toContain("issueCreditNote(tx");
  });

  test("return refunds refuse to start a second operation while one is already pending", () => {
    expect(returns).toContain('["REFUND_PENDING", "REFUND_FAILED"].includes(lockedPayment[0]?.status)');
    expect(returns).toContain("REFUND_ALREADY_PENDING");
  });

  test("order cancellation queues an online refund without pinning or calling Stripe", () => {
    expect(orders).not.toContain("refunds.create");
    expect(orders).not.toContain("pendingRefundAmount: remaining,");
    expect(orders).not.toContain("pendingRefundIdempotencyKey: refundIdempotencyKey,");
    expect(orders).toContain("queueManualRefund(tx");
  });

  test("order cancellation refuses to start a second refund while one is already pending on the same payment", () => {
    expect(orders).toContain('["REFUND_PENDING", "REFUND_FAILED"].includes(order.payment.status)');
  });
});

// Legacy pins remain only for historical recovery. New cancellation paths
// queue the precise amount for an administrator to refund in Stripe.
describe("reservation cancellations queue refunds for manual execution", () => {
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
    // markRefundFailed must NOT null out the pending fields: the original
    // amount remains available for reconciliation and audit.
    const failedFn = helper.slice(
      helper.indexOf("export function markRefundFailed"),
      helper.indexOf("export function clearPendingRefund")
    );
    expect(failedFn).not.toContain("pendingRefundAmount: null");
  });

  test("cancelReservation (customer) queues a refund without a Stripe retry pin", () => {
    expect(cancelReservation).not.toContain("refunds.create");
    expect(cancelReservation).not.toContain("pinPendingRefund");
    expect(cancelReservation).not.toContain("markRefundFailed");
    expect(cancelReservation).toContain("queueManualRefund(tx");
    expect(cancelReservation).toContain("issueCreditNote(tx");
  });

  // Converted: an admin now refunds this by hand in Stripe, so there is no
  // call to pin and no Stripe call to replay.
  // The money is recorded as owed instead of being sent.
  //   2026-09-02: cancelWorkshopReservation, cancelFormationReservation
  //   2026-09-03: rejectAppointment
  for (const [name, mod] of [
    ["cancelWorkshopReservation", cancelWorkshop],
    ["cancelFormationReservation", cancelFormation],
    ["rejectAppointment (staff/admin)", rejectAppointment],
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

  test("cancelReservation (customer path) creates a durable work item before returning success", () => {
    const queueCall = cancelReservation.indexOf("queueManualRefund(tx");
    const success = cancelReservation.indexOf("success: true", queueCall);
    expect(queueCall).toBeGreaterThan(-1);
    expect(success).toBeGreaterThan(queueCall);
  });
});
