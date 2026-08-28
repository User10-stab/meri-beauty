import { describe, expect, it } from "vitest";
import { calculateCartPricing, calculateItemPricing } from "@/lib/pricing";

// ProductVariant stores 121/145.20 TTC. serializeCart derives these HT twins
// so the pricing helper can apply the rate that actually applies.
const cartItem = {
  quantity: 2,
  variant: {
    priceExclVat: 100,
    comparePriceExclVat: 120,
  },
};

describe("boutique cart VAT pricing", () => {
  it("keeps the stored TTC amount as the Belgian customer price", () => {
    expect(calculateItemPricing(cartItem)).toMatchObject({
      unitPrice: 121,
      totalPrice: 242,
      subtotalExclVat: 200,
      vatAmount: 42,
    });
  });

  it("charges the extracted HT price for the 0% intra-Community preview", () => {
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
