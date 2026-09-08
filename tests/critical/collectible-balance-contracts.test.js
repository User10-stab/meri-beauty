import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  collectibleBalance,
  isBalanceCollectible,
  NON_COLLECTIBLE_LIFECYCLE_STATUSES,
  NON_COLLECTIBLE_PAYMENT_STATUSES,
} from "@/lib/payments/collectible-balance";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8").replace(/\r\n/g, "\n");

/**
 * A refunded transaction used to tell staff "Solde à encaisser : 40 €".
 * Payment.remainingAmount is the ORIGINAL payment-plan balance and survives
 * cancellation and refund untouched — settle-leg only moves Payment.status.
 * Four screens each carried their own copy of the correction; the rule now
 * lives in one module, and these tests are what keeps it that way.
 */
describe("collectible balance", () => {
  test("a live booking still owes its plan balance", () => {
    expect(
      collectibleBalance({ remainingAmount: 40, paymentStatus: "PARTIALLY_PAID", lifecycleStatus: "CONFIRMED" }),
    ).toBe(40);
  });

  test("a refunded payment owes nothing, whatever the booking still says", () => {
    expect(
      collectibleBalance({ remainingAmount: 40, paymentStatus: "REFUNDED", lifecycleStatus: "CONFIRMED" }),
    ).toBe(0);
  });

  test("a cancelled booking owes nothing, whatever the payment still says", () => {
    expect(
      collectibleBalance({ remainingAmount: 40, paymentStatus: "PAID", lifecycleStatus: "CANCELLED" }),
    ).toBe(0);
  });

  test("a decided-but-unconfirmed refund already stops collection", () => {
    // REFUND_PENDING/REFUND_FAILED both mean money is on its way back out.
    // Asking staff to collect the plan balance in that state is how a
    // customer gets charged on a record that is being unwound.
    for (const paymentStatus of ["REFUND_PENDING", "REFUND_FAILED"]) {
      expect(collectibleBalance({ remainingAmount: 40, paymentStatus })).toBe(0);
    }
  });

  test("a partial refund does not zero the balance and does not re-charge the refunded part", () => {
    // A partial refund gives back part of what was PAID. It never touches the
    // unpaid part of the plan, so the unpaid part stays due as-is.
    expect(
      collectibleBalance({ remainingAmount: 40, paymentStatus: "PARTIALLY_REFUNDED", lifecycleStatus: "CONFIRMED" }),
    ).toBe(40);
  });

  test("COMPLETED and NO_SHOW keep their balance collectible", () => {
    // A finished service or a forfeited no-show can legitimately still owe.
    expect(NON_COLLECTIBLE_LIFECYCLE_STATUSES).not.toContain("COMPLETED");
    expect(NON_COLLECTIBLE_LIFECYCLE_STATUSES).not.toContain("NO_SHOW");
    expect(collectibleBalance({ remainingAmount: 40, lifecycleStatus: "NO_SHOW" })).toBe(40);
  });

  test("never returns a negative or non-numeric balance", () => {
    expect(collectibleBalance({ remainingAmount: -5 })).toBe(0);
    expect(collectibleBalance({ remainingAmount: null })).toBe(0);
    expect(collectibleBalance({ remainingAmount: "not a number" })).toBe(0);
    expect(collectibleBalance()).toBe(0);
  });

  test("missing statuses do not silently suppress a real balance", () => {
    // Every caller passes what it has; an unknown status is not a reason to
    // hide money that is owed.
    expect(isBalanceCollectible({})).toBe(true);
    expect(collectibleBalance({ remainingAmount: 40 })).toBe(40);
  });

  test("every screen that shows a balance reads the shared rule, none re-derives it", () => {
    const screens = [
      "components/customer/MyReservationsClient.jsx",
      "components/dashboard/calendar/AppointmentDrawer.jsx",
      "components/dashboard/operations/TransactionDetailDrawer.jsx",
      "components/dashboard/operations/AdminOperationsClient.jsx",
    ];
    for (const screen of screens) {
      const code = source(screen);
      expect(code, screen).toContain('from "@/lib/payments/collectible-balance"');
      // The local copies each open-coded this status list. If one comes back,
      // the four screens can disagree again.
      expect(code, screen).not.toMatch(/\["CANCELLED", "REJECTED", "EXPIRED"\]/);
    }
  });

  test("the payment and lifecycle status lists stay disjoint concerns", () => {
    // Mixing them is what let AppointmentDrawer test a payment status against
    // a booking status in a single list.
    for (const status of NON_COLLECTIBLE_PAYMENT_STATUSES) {
      expect(NON_COLLECTIBLE_LIFECYCLE_STATUSES).not.toContain(status);
    }
  });
});
