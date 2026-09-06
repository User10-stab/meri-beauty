import { describe, expect, test } from "vitest";
import { resolveCounterPriceAdjustment } from "@/lib/payments/counter-price-adjustment";

describe("counter price adjustments", () => {
  test("keeps the quoted total when no adjustment was requested", () => {
    expect(resolveCounterPriceAdjustment({ baseTotal: 80, paidAmount: 40 })).toMatchObject({
      success: true,
      changed: false,
      finalTotal: 80,
      amountDue: 40,
    });
  });

  test("recomputes the balance after a reasoned adjustment", () => {
    expect(
      resolveCounterPriceAdjustment({
        baseTotal: 80,
        paidAmount: 40,
        finalTotal: 65,
        reason: "Geste commercial",
      }),
    ).toMatchObject({ success: true, changed: true, finalTotal: 65, amountDue: 25 });
  });

  test("requires a reason whenever the final total changes", () => {
    expect(resolveCounterPriceAdjustment({ baseTotal: 80, paidAmount: 40, finalTotal: 65 })).toMatchObject({
      success: false,
    });
  });

  test("never disguises a refund as a till-side price edit", () => {
    const result = resolveCounterPriceAdjustment({
      baseTotal: 80,
      paidAmount: 40,
      finalTotal: 35,
      reason: "Correction",
    });
    expect(result.success).toBe(false);
    expect(result.message).toContain("remboursement");
  });

  test("rounds money to cents before comparing", () => {
    expect(
      resolveCounterPriceAdjustment({
        baseTotal: 49.999,
        paidAmount: 20,
        finalTotal: 50,
        reason: "not needed",
      }),
    ).toMatchObject({ success: true, changed: false, amountDue: 30 });
  });
});
