import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8").replace(/\r\n/g, "\n");

const CANCELLATION_PATHS = [
  ["actions/formations/manage-reservation.js", "formation"],
  ["actions/workshops/manage-reservation.js", "atelier"],
];

/**
 * A cancelled booking cannot still be owed money.
 *
 * Cancelling a reservation leaves the money wherever it is — refunded to the
 * customer, or forfeited as a non-refundable deposit — but in both cases the
 * salon will never collect another cent against it. Two fields were left
 * saying otherwise: `Payment.remainingAmount` and `Reservation.balanceDue`.
 *
 * Measured on the dev database before this fix: **34 payments** on cancelled
 * bookings still claimed a balance (28 workshop REFUNDED, 2 formation
 * REFUNDED, 4 formation PAID) and **61 cancelled reservations** still carried
 * a `balanceDue`. The rows read as a contradiction — "REFUNDED" beside "still
 * owes €60" — and any report answering "how much is outstanding?" would count
 * money that is never coming.
 *
 * Nothing reads those fields for a cancelled booking today, because the
 * counter only searches CONFIRMED reservations. That is what kept this
 * invisible; it is not what makes it correct.
 *
 * The distribution above is the reason the zeroing lives in ONE place rather
 * than in each money branch. There are three payment updates across the two
 * files, and only the forfeit one was an obvious home for it — so the refund
 * path, which is where most of the wrong rows came from, was the one that got
 * missed. A new branch added later inherits the fix instead of having to
 * remember it.
 */
describe("cancelling a booking clears what it is owed", () => {
  test.each(CANCELLATION_PATHS)("%s — the reservation's balance is cleared", (path) => {
    const module = source(path);
    const claimAt = module.indexOf('status: "CANCELLED"');
    expect(claimAt, `${path}: no cancellation update found`).toBeGreaterThan(-1);
    // Scoped to the cancellation update itself: a `balanceDue: 0` somewhere
    // else in the file would satisfy a bare toContain while leaving the
    // cancellation path untouched.
    const block = module.slice(claimAt, claimAt + 600);
    expect(block, `${path}: a cancelled booking still carries a balanceDue`).toContain("balanceDue: 0");
  });

  test.each(CANCELLATION_PATHS)("%s — the payment stops claiming an outstanding amount", (path) => {
    const module = source(path);
    expect(module).toContain(
      'await tx.payment.update({ where: { id: payment.id }, data: { remainingAmount: 0 } });',
    );
  });

  test.each(CANCELLATION_PATHS)("%s — it happens before the money branches, not inside one", (path) => {
    const module = source(path);
    const zeroAt = module.indexOf("data: { remainingAmount: 0 }");
    const firstBranchAt = module.search(/if \((?:refundPayment|refundDeposit) && payment\)/);
    expect(firstBranchAt, `${path}: no refund branch found`).toBeGreaterThan(-1);
    // Inside a branch it would only apply to that branch — which is exactly
    // how the refund path came to be the worst offender.
    expect(
      zeroAt,
      `${path}: the balance is cleared inside a money branch, so another branch can still miss it`,
    ).toBeLessThan(firstBranchAt);
  });

  test.each(CANCELLATION_PATHS)("%s — what was actually paid is left alone", (path) => {
    const module = source(path);
    // The fix must not touch the record of the money that really arrived.
    // paidAmount is what the revenue reports sum (REVENUE_STATUSES in
    // get-reports-data.js), and paymentType/totalAmount are how anyone later
    // sees this was a part-payment on a larger booking.
    expect(module, `${path}: the cancellation rewrites what was collected`).not.toContain(
      "paidAmount: 0",
    );
    expect(module).not.toContain("totalAmount: 0");
  });

  test("the refund path is covered too, not just the forfeited deposit", () => {
    // The forfeit branch sets status PAID; the refund branch sets REFUNDED or
    // hands off to queueManualRefund. All of them are downstream of the single
    // zeroing above, which is the property this asserts.
    for (const [path] of CANCELLATION_PATHS) {
      const module = source(path);
      const zeroAt = module.indexOf("data: { remainingAmount: 0 }");
      for (const marker of ['data: { status: "PAID" }', 'data: { status: "REFUNDED" }']) {
        const at = module.indexOf(marker);
        if (at === -1) continue;
        expect(zeroAt, `${path}: ${marker} runs before the balance is cleared`).toBeLessThan(at);
      }
    }
  });

  test("queueManualRefund does not compute from the field being zeroed", () => {
    // The zeroing happens before the refund is queued, so a refund amount
    // derived from remainingAmount would silently become zero. It is derived
    // from the transactions instead — pinned here because the ordering above
    // depends on it.
    expect(source("lib/refunds/queue-manual-refund.js")).not.toContain("remainingAmount");
  });
});
