import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { applyVatRate, BELGIUM_VAT_RATE, calculateVatTotals } from "@/lib/tax-policy";
import { calculateItemPricing } from "@/lib/pricing";
import { calculateShippingCost } from "@/lib/shipping";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8").replace(/\r\n/g, "\n");

describe("VAT is added to a net price, never stripped from a gross one", () => {
  test("the rate is applied, not undone", () => {
    expect(applyVatRate(100, 21)).toBe(121);
    expect(applyVatRate(100, 6)).toBe(106);
    expect(applyVatRate(100, 0)).toBe(100);
  });

  test("the old strip-then-reapply behaviour is gone", () => {
    // repriceBelgianGross divided by 1.21 first. Passing a net price through
    // that would have under-charged by 21%.
    expect(source("lib/tax-policy.js")).not.toContain("repriceBelgianGross");
    expect(source("lib/tax-policy.js")).not.toContain("/ (1 + BELGIUM_VAT_RATE / 100)");
  });

  test("nothing anywhere still calls the old name", () => {
    for (const file of [
      "lib/pricing.js",
      "actions/boutique/orders.js",
      "actions/boutique/point-of-sale.js",
      "actions/boutique/shipping.js",
      "actions/workshops/create-workshop-reservation.js",
      "actions/formations/create-formation-reservation.js",
      "components/boutique/CheckoutPageClient.jsx",
    ]) {
      expect(source(file), `${file} still references repriceBelgianGross`).not.toContain(
        "repriceBelgianGross"
      );
    }
  });
});

// Every price in the shop was a Belgian gross amount. The migration divides by
// 1.21 — and the column had to be widened first, or that round-trip would move
// 17% of prices by a cent the day it ran.
describe("no customer sees a different price after the migration", () => {
  const migration = source(
    "prisma/migrations/20260824180000_catalogue_prices_net_of_vat/migration.sql"
  );

  test("the columns are widened before the division, not after", () => {
    const widenIdx = migration.indexOf('ALTER COLUMN "price" TYPE DECIMAL(10,4)');
    const divideIdx = migration.indexOf('SET "price"        = ROUND("price" / 1.21, 4)');
    expect(widenIdx).toBeGreaterThan(-1);
    expect(divideIdx).toBeGreaterThan(widenIdx);
  });

  test("four decimals round-trip exactly where two would drift", () => {
    const round2 = (v) => Math.round((v + Number.EPSILON) * 100) / 100;
    const round4 = (v) => Math.round((v + Number.EPSILON) * 10000) / 10000;

    let driftAt2 = 0;
    let driftAt4 = 0;
    for (let cents = 100; cents <= 20000; cents += 1) {
      const gross = cents / 100;
      if (applyVatRate(round2(gross / 1.21), BELGIUM_VAT_RATE) !== gross) driftAt2 += 1;
      if (applyVatRate(round4(gross / 1.21), BELGIUM_VAT_RATE) !== gross) driftAt4 += 1;
    }
    expect(driftAt4).toBe(0);
    expect(driftAt2).toBeGreaterThan(0); // the reason the widening exists
  });

  test("the worked example from the invoice survives the round trip", () => {
    // 25,95 € was the price on invoice 2026-000042.
    const net = 21.4463;
    expect(applyVatRate(net, BELGIUM_VAT_RATE)).toBe(25.95);
    expect(calculateVatTotals(25.95, 21)).toEqual({
      totalInclVat: 25.95,
      totalExclVat: 21.45,
      vatAmount: 4.5,
    });
  });

  test("all three catalogues are converted, and cost price is not", () => {
    for (const table of ['"ProductVariant"', '"workshops"', '"formations"']) {
      expect(migration).toContain(table);
    }
    // A supplier cost was never a VAT-inclusive shelf price.
    expect(migration).not.toMatch(/SET\s+"costPrice"/);
    expect(migration).toContain("costPrice is untouched");
  });

  test("it warns that re-running would halve the catalogue again", () => {
    expect(migration).toContain("ONE-SHOT AND IRREVERSIBLE");
  });
});

describe("the consumer always sees a VAT-inclusive price", () => {
  test("the storefront adds VAT at the serialization boundary", () => {
    // Directive 98/6/CE art. 2(a): the advertised price is the final price,
    // VAT included. Doing it here means no display component can forget.
    const storefront = source("actions/boutique/storefront.js");
    expect(storefront).toContain("const shopPrice = (value) => applyVatRate(Number(value), BELGIUM_VAT_RATE)");
    expect(storefront).toContain("price: shopPrice(variant.price)");
    expect(storefront).toContain("priceExclVat: Number(variant.price)");
  });

  test("the cart does the same, and carries the net twin for repricing", () => {
    const cart = source("actions/boutique/cart.js");
    expect(cart).toContain("price: applyVatRate(Number(item.variant.price), BELGIUM_VAT_RATE)");
    expect(cart).toContain("priceExclVat: Number(item.variant.price)");
    expect(cart).toContain("comparePriceExclVat:");
  });

  test("repricing starts from the net twin, so 21% is never compounded", () => {
    // serializeCart's `price` is already gross; taxing it again would charge
    // 21% on top of 21%.
    const checkout = source("components/boutique/CheckoutPageClient.jsx");
    expect(checkout).toContain("applyVatRate(item.variant.priceExclVat");
    expect(checkout).not.toContain("applyVatRate(item.variant.price,");

    const pricing = source("lib/pricing.js");
    expect(pricing).toContain("Number(item.variant.priceExclVat)");
    expect(pricing).not.toContain("Number(item.variant.price)");
  });

  test("a cart line prices the same as before the change", () => {
    const item = { quantity: 2, variant: { priceExclVat: 100, comparePriceExclVat: 120 } };
    expect(calculateItemPricing(item)).toMatchObject({
      unitPrice: 121,
      totalPrice: 242,
      subtotalExclVat: 200,
      vatAmount: 42,
    });
    // A validated intra-Community B2B buyer pays the bare net price.
    expect(calculateItemPricing(item, 0)).toMatchObject({ unitPrice: 100, totalPrice: 200, vatAmount: 0 });
  });
});

describe("shipping is taxed once, at the customer's rate", () => {
  test("the tiers hold the carrier's own HT grid", () => {
    const shipping = source("lib/shipping.js");
    expect(shipping).toContain("{ maxGrams: 500, price: 3.12 }");
    // Structural, not lexical: no tier wraps its price in a conversion call.
    // Adding VAT here and stripping it downstream was a double conversion.
    expect(shipping).not.toMatch(/price: [A-Za-z_]\w*\(/);
  });

  test("calculateShippingCost returns the net figure", () => {
    expect(calculateShippingCost(400, 10)).toBe(3.12);
    expect(applyVatRate(calculateShippingCost(400, 10), BELGIUM_VAT_RATE)).toBe(3.78);
  });

  test("free shipping and the over-30kg quote still work", () => {
    expect(calculateShippingCost(400, 150)).toBe(0);
    expect(calculateShippingCost(40000, 10)).toBe("QUOTE_REQUIRED");
  });
});

describe("the admin form states the basis it was silent about", () => {
  const editor = source("components/dashboard/boutique/ProductEditor.jsx");

  test("every price field says whether it is HT", () => {
    // "Prix de vente (€)" was the whole cause: the convention governing every
    // boutique calculation lived only in code comments Marie never reads.
    expect(editor).toContain('label="Prix de vente HT (€)"');
    expect(editor).toContain("label=\"Prix d'achat HT (€)\"");
    expect(editor).toContain('label="Prix barré HT (€)"');
  });

  test("it shows the resulting shelf price live", () => {
    expect(editor).toContain("const shelfPrice = applyVatRate(price, BELGIUM_VAT_RATE)");
    expect(editor).toContain("TTC en boutique");
  });

  test("the margin now subtracts two comparable bases", () => {
    expect(editor).toContain("Both figures are net");
  });
});

// The atelier / formation / event pages read Prisma directly, so nothing
// serialized their prices for them — after the migration they would have shown
// the net figure to consumers.
//
// The display itself is delegated to components/activities/ActivityPrice.jsx
// rather than computed inline: a validated foreign-EU B2B viewer sees the net
// service price (art. 44/196 — no dispatch condition, unlike goods), everyone
// else the VAT-inclusive one. Doing this per-page with a fixed 21% would have
// shown a validated pro the wrong price at booking time, same bug the
// storefront had.
describe("activity pages show the shelf price, not the net one", () => {
  test.each([
    ["app/(public)/evenements/page.js"],
    ["app/(public)/evenements/[id]/page.js"],
    ["app/(public)/formations/page.js"],
    ["app/(public)/formations/[id]/page.js"],
    ["app/(public)/animateurs/[id]/page.js"],
  ])("%s delegates pricing to ActivityPrice", (file) => {
    const content = source(file);
    expect(content).toContain('from "@/components/activities/ActivityPrice"');
    expect(content).toContain("<ActivityPriceTag");
  });

  test("ActivityPrice applies VAT through the viewer's own service policy", () => {
    const content = source("components/activities/ActivityPrice.jsx");
    expect(content).toContain('from "@/lib/tax-policy"');
    expect(content).toContain("applyVatRate(");
    expect(content).toContain('from "@/actions/vat/viewer-policy"');
    expect(content).toContain("getViewerServiceVatPolicy");
  });

  test("the viewer policy action resolves services separately from goods", () => {
    const content = source("actions/vat/viewer-policy.js");
    expect(content).toContain("resolveServiceVatPolicy");
    expect(content).toContain("resolveGoodsVatPolicy");
  });

  test.each([
    ["app/(public)/evenements/[id]/page.js", "activity"],
    ["app/(public)/formations/[id]/page.js", "formation"],
  ])("%s delegates the deposit breakdown too", (file, entity) => {
    const content = source(file);
    expect(content).toContain("<ActivityDepositNote");
    // Nothing left in the page computing the split against a fixed rate.
    expect(content).not.toContain(`(${entity}.price * depositPct)`);
    expect(content).not.toContain("shelfPrice");
  });

  test("ActivityDepositNote computes the split from the same priced figure", () => {
    // A 50% acompte computed on the net price would under-collect.
    const content = source("components/activities/ActivityPrice.jsx");
    expect(content).toContain("const depositAmount = (price * depositPct) / 100;");
    expect(content).toContain("const balanceAmount = price - depositAmount;");
  });

  test("the booking forms already priced through applyVatRate", () => {
    for (const file of [
      "app/(public)/reservation-atelier/page.js",
      "app/(public)/reservation-formation/page.js",
    ]) {
      expect(source(file)).toContain("applyVatRate(catalogueUnitPrice, vatPolicy.vatRate)");
    }
  });

  test("the atelier and formation admin fields say HT as well", () => {
    const fr = source("messages/fr.json");
    expect(fr).toContain('"priceLabel": "Tarif HT (€)"');
    expect(fr).not.toContain('"priceLabel": "Tarif (€)"');
  });
});

// The till quotes a price out loud and takes cash against it. If the screen
// showed the net figure while the server charged the gross one, the drawer
// would be short on every single sale.
describe("the till quotes exactly what it charges", () => {
  const action = source("actions/boutique/point-of-sale.js");
  const client = source("components/dashboard/boutique/PointOfSaleClient.jsx");

  test("product lookups return the shelf price", () => {
    expect(action.match(/unitPrice: applyVatRate\(Number\(variant\.price\), BELGIUM_VAT_RATE\)/g) ?? [])
      .toHaveLength(2); // barcode lookup + name search
  });

  test("the displayed price is never what gets charged", () => {
    // completePointOfSaleSale re-reads the variant inside the transaction and
    // applies the rate itself, so a tampered client price cannot set the total.
    expect(action).toContain("taxUnitPrice: applyVatRate(item.price, posVatPolicy.vatRate)");
    expect(action).toContain("select: { id: true, name: true, sku: true, price: true");
  });

  test("an ad-hoc service is typed gross and sent net", () => {
    expect(client).toContain('placeholder="Prix TTC €"');
    expect(client).toContain("unitPriceExclVat: price / (1 + BELGIUM_VAT_RATE / 100)");
    expect(client).toContain("unitPrice: item.unitPriceExclVat");
  });

  test("the service round-trip is exact, because the net is never rounded", () => {
    // Rounding the intermediate would shift 17% of typed prices by a cent
    // between the screen and the receipt.
    for (const cents of [1, 7, 14, 3500, 2595, 9999]) {
      const typed = cents / 100;
      expect(applyVatRate(typed / (1 + BELGIUM_VAT_RATE / 100), BELGIUM_VAT_RATE)).toBe(typed);
    }
  });
});
