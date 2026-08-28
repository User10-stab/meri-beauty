import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8");

describe("boutique VAT display matches server charging", () => {
  test("the shipping preview resolves the signed-in customer's VAT policy", () => {
    const shipping = source("actions/boutique/shipping.js");
    expect(shipping).toContain("resolveGoodsVatPolicy({ customer })");
    expect(shipping).toContain("repriceTtcCataloguePrice(item.variant.price, vatPolicy.vatRate)");
    expect(shipping).toContain("applyVatRate(catalogueCost, vatPolicy.vatRate)");
  });

  test("checkout reprices products before charging promotions and total against them", () => {
    const checkout = source("components/boutique/CheckoutPageClient.jsx");
    expect(checkout).toContain("const vatSubtotal = useMemo(");
    // A promo code applies to the price the customer was quoted, which is the
    // VAT-inclusive one — the displayed breakdown nets it down separately.
    expect(checkout).toContain("<PromoCodeField subtotal={vatSubtotal}");
    expect(checkout).toContain("vatSubtotal + shippingCost - discountAmount");
  });

  test("checkout shows HT, carriage, VAT and TTC — while cart stays delivery-free", () => {
    const checkout = source("components/boutique/CheckoutPageClient.jsx");
    for (const label of ["Sous-total HT", "Livraison HT", "TVA (", "Total TTC"]) {
      expect(checkout, `checkout summary is missing "${label}"`).toContain(label);
    }
    // Order matters: the price is built from the net side up, and the invoice
    // issued for this order prints the same four figures in the same order.
    const at = (needle) => checkout.indexOf(needle);
    expect(at("Sous-total HT")).toBeLessThan(at("Livraison HT"));
    expect(at("Livraison HT")).toBeLessThan(at(">TVA ("));
    expect(at(">TVA (")).toBeLessThan(at("Total TTC"));

    const cart = source("components/boutique/CartPageClient.jsx");
    expect(cart).not.toContain('t("shippingExclVat")');
    expect(cart).not.toContain("getCartShippingCost");
    expect(cart).toContain("totalTTC: roundMoney(cartPricing.totalTTC)");
    expect(cart).toContain('t("vat", { rate: vatRate })');
    expect(cart).toContain('t("totalInclVat")');
  });

  test("carriage reaches the cart as a net figure, not one divided back down", () => {
    const shipping = source("actions/boutique/shipping.js");
    // The Mondial Relay grid is already HT. Returning `cost / 1.21` instead
    // would round a second time and drift a cent off the invoice.
    expect(shipping).toContain("costExclVat: catalogueCost");
    expect(shipping).not.toContain("costExclVat: cost /");
  });

  test("a booked atelier or formation shows the same breakdown as a product", () => {
    for (const page of [
      "app/(public)/reservation-atelier/page.js",
      "app/(public)/reservation-formation/page.js",
    ]) {
      const content = source(page);
      expect(content, `${page} does not render the shared breakdown`).toContain(
        "<ServicePriceBreakdown"
      );
      expect(content).toContain("unitPriceInclVat={unitPrice}");
    }

    const breakdown = source("components/shared/ServicePriceBreakdown.jsx");
    expect(breakdown).toContain("Total TTC");
    expect(breakdown).toContain("TVA (");
  });
});
