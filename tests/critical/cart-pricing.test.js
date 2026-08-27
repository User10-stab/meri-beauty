import { describe, expect, it } from "vitest";
import { calculateCartPricing, calculateItemPricing } from "@/lib/pricing";

// Net catalogue figures, as serializeCart now hands them over: `price` on a
// serialized item is already VAT-inclusive for display, so the pricing helper
// reads the net twins instead and applies the rate that actually applies.
const cartItem = {
  quantity: 2,
  variant: {
    priceExclVat: 100,
    comparePriceExclVat: 120,
  },
};

describe("boutique cart VAT pricing", () => {
  it("adds 21% to a net catalogue price by default", () => {
    expect(calculateItemPricing(cartItem)).toMatchObject({
      unitPrice: 121,
      totalPrice: 242,
      subtotalExclVat: 200,
      vatAmount: 42,
    });
  });

  it("charges the bare net price for the 0% intra-Community preview", () => {
    expect(calculateItemPricing(cartItem, 0)).toMatchObject({
      unitPrice: 100,
      totalPrice: 200,
      subtotalExclVat: 200,
      vatAmount: 0,
      originalPrice: 240,
      savings: 40,
    });

    expect(calculateCartPricing([cartItem], 0)).toMatchObject({
      totalHT: 200,
      totalVAT: 0,
      totalTTC: 200,
    });
  });
});
