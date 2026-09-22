import { describe, expect, test } from "vitest";
import { checkoutSchema } from "../../lib/validations/commerce.js";

// Mondial Relay itself rejects a non-international recipient phone (e.g.
// "+322323232232323" — real incident, 2026-09-22: reached label generation
// on an already-paid order before failing). Catching it at checkout instead
// surfaces the problem to the customer, not to staff days later on a paid
// order. Scoped to SHIPPING_PREPAID only — in-salon pickup phones are just a
// contact number, never sent to a carrier.
function payload(overrides = {}) {
  return {
    fulfilmentMode: "SHIPPING_PREPAID",
    customerInfo: { fullName: "Jean Dupont", email: "jean@example.com", phone: "+32470123456" },
    pickupPoint: { id: "041285", name: "3 BRO", address: "Rue X", postalCode: "1090", city: "Jette" },
    termsAccepted: true,
    ...overrides,
  };
}

describe("checkout phone format — SHIPPING_PREPAID only", () => {
  test("a well-formed international number passes", () => {
    expect(checkoutSchema.safeParse(payload()).success).toBe(true);
  });

  test("the real malformed number from the field incident is rejected", () => {
    const result = checkoutSchema.safeParse(
      payload({ customerInfo: { ...payload().customerInfo, phone: "+322323232232323" } })
    );
    expect(result.success).toBe(false);
    expect(result.error.flatten().fieldErrors.customerInfo?.[0]).toContain("format international");
  });

  test("a bare local number without a country code is rejected", () => {
    const result = checkoutSchema.safeParse(
      payload({ customerInfo: { ...payload().customerInfo, phone: "0470123456" } })
    );
    expect(result.success).toBe(false);
  });

  test("a country code starting with 0 is rejected (not a real E.164 country code)", () => {
    const result = checkoutSchema.safeParse(
      payload({ customerInfo: { ...payload().customerInfo, phone: "+0470123456" } })
    );
    expect(result.success).toBe(false);
  });

  test("spaces/dots/dashes in an otherwise valid number are tolerated", () => {
    const result = checkoutSchema.safeParse(
      payload({ customerInfo: { ...payload().customerInfo, phone: "+32 470.12-34 56" } })
    );
    expect(result.success).toBe(true);
  });

  test.each(["PICKUP_PREPAID", "PICKUP_ON_SITE"])(
    "%s never enforces phone format — it's not sent to any carrier",
    (fulfilmentMode) => {
      const result = checkoutSchema.safeParse({
        fulfilmentMode,
        customerInfo: { fullName: "Jean Dupont", email: "jean@example.com", phone: "0470123456" },
        pickupPoint: null,
        termsAccepted: true,
      });
      expect(result.success).toBe(true);
    }
  );
});
