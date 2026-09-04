import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { BOUTIQUE_SHIPPING_DISABLED_MESSAGE, isBoutiqueShippingEnabled } from "../../lib/commerce-availability.js";

const root = path.resolve(import.meta.dirname, "../..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

describe("boutique shipping availability", () => {
  it("keeps local delivery usable but defaults production to disabled", () => {
    expect(isBoutiqueShippingEnabled({ NODE_ENV: "development" })).toBe(true);
    expect(isBoutiqueShippingEnabled({ NODE_ENV: "production" })).toBe(false);
    expect(isBoutiqueShippingEnabled({ NODE_ENV: "production", BOUTIQUE_SHIPPING_ENABLED: "true" })).toBe(true);
    expect(isBoutiqueShippingEnabled({ NODE_ENV: "development", BOUTIQUE_SHIPPING_ENABLED: "false" })).toBe(false);
  });

  it("enforces the pause before a shipping order can reserve stock or open Stripe", () => {
    const orders = read("actions/boutique/orders.js");
    const shipping = read("actions/boutique/shipping.js");

    expect(orders).toContain('fulfilmentMode === "SHIPPING_PREPAID" && !isBoutiqueShippingEnabled()');
    expect(orders).toContain("BOUTIQUE_SHIPPING_DISABLED_MESSAGE");
    expect(shipping).toContain("export async function getCartShippingCost()");
    expect(shipping).toContain("export async function requestShippingQuote(input)");
    expect(shipping).toContain("!isBoutiqueShippingEnabled()");
    expect(BOUTIQUE_SHIPPING_DISABLED_MESSAGE).toContain("temporairement indisponible");
  });
});
