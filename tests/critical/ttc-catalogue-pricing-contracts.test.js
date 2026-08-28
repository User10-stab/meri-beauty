import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  BELGIUM_VAT_RATE,
  applyVatRate,
  calculateVatTotals,
  cataloguePriceExclVat,
  repriceTtcCataloguePrice,
} from "@/lib/tax-policy";
import { calculateItemPricing } from "@/lib/pricing";
import { calculateShippingCost } from "@/lib/shipping";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8").replace(/\r\n/g, "\n");

describe("catalogue prices are stored TTC", () => {
  test("21% is included rather than added again", () => {
    expect(cataloguePriceExclVat(121)).toBe(100);
    expect(repriceTtcCataloguePrice(121, BELGIUM_VAT_RATE)).toBe(121);
    expect(repriceTtcCataloguePrice(121, 0)).toBe(100);
    expect(calculateVatTotals(121, 21)).toEqual({
      totalInclVat: 121,
      totalExclVat: 100,
      vatAmount: 21,
    });
  });

  test("the new migration reverses the mistaken net conversion for every catalogue", () => {
    const migration = source(
      "prisma/migrations/20260828160000_restore_catalogue_prices_ttc/migration.sql"
    );
    for (const table of ['"ProductVariant"', '"workshops"', '"formations"']) {
      expect(migration).toContain(table);
    }
    expect(migration.match(/\* 1\.21/g)).toHaveLength(4);
    expect(migration).not.toMatch(/"costPrice"\s*\*\s*1\.21/);
  });

  test("the schema declares two-decimal TTC catalogue amounts", () => {
    const schema = source("prisma/schema.prisma");
    expect(schema).toContain("Customer-facing catalogue price, stored TTC");
    expect(schema).toContain("price        Decimal  @db.Decimal(10, 2)");
    expect(schema).toContain("comparePrice Decimal? @db.Decimal(10, 2)");
  });
});

describe("boutique paths never add VAT to a stored product price", () => {
  test("storefront and cart return the stored TTC amount directly", () => {
    const storefront = source("actions/boutique/storefront.js");
    expect(storefront).toContain("price: Number(variant.price)");
    expect(storefront).toContain("priceExclVat: cataloguePriceExclVat(variant.price)");
    expect(storefront).not.toContain("shopPrice(");

    const cart = source("actions/boutique/cart.js");
    expect(cart).toContain("price: Number(item.variant.price)");
    expect(cart).toContain("priceExclVat: cataloguePriceExclVat(item.variant.price)");
  });

  test("checkout and cart calculations use the derived HT twin", () => {
    const checkout = source("components/boutique/CheckoutPageClient.jsx");
    expect(checkout).toContain("applyVatRate(item.variant.priceExclVat");

    const item = {
      quantity: 2,
      variant: { priceExclVat: cataloguePriceExclVat(121), comparePriceExclVat: null },
    };
    expect(calculateItemPricing(item)).toMatchObject({
      unitPrice: 121,
      totalPrice: 242,
      subtotalExclVat: 200,
      vatAmount: 42,
    });
    expect(calculateItemPricing(item, 0)).toMatchObject({ unitPrice: 100, totalPrice: 200, vatAmount: 0 });
  });

  test("orders and POS re-read and reprice the stored TTC value server-side", () => {
    const orders = source("actions/boutique/orders.js");
    expect(orders).toContain("repriceTtcCataloguePrice(item.variant.price, taxPolicy.vatRate)");

    const pos = source("actions/boutique/point-of-sale.js");
    expect(pos.match(/unitPrice: Number\(variant\.price\)/g) ?? []).toHaveLength(2);
    expect(pos).toContain("taxUnitPrice: repriceTtcCataloguePrice(item.price, posVatPolicy.vatRate)");
  });
});

describe("other price bases remain explicit", () => {
  test("shipping tariffs remain HT and receive VAT once", () => {
    expect(calculateShippingCost(400, 10)).toBe(3.12);
    expect(applyVatRate(calculateShippingCost(400, 10), BELGIUM_VAT_RATE)).toBe(3.78);
  });

  test("admin forms label customer catalogue prices TTC", () => {
    const editor = source("components/dashboard/boutique/ProductEditor.jsx");
    expect(editor).toContain('label="Prix de vente TTC (€)"');
    expect(editor).toContain('label="Prix barré TTC (€)"');
    expect(editor).toContain('label="Prix d\'achat HT (€)"');
    expect(editor).toContain("Le montant saisi est sauvegardé et affiché tel quel");

    const fr = source("messages/fr.json");
    expect(fr.match(/"priceLabel": "Tarif TTC \(€\)"/g)).toHaveLength(2);
    expect(source("messages/en.json").match(/"priceLabel": "Price incl\. VAT \(€\)"/g)).toHaveLength(2);
    expect(source("messages/nl.json").match(/"priceLabel": "Prijs incl\. btw \(€\)"/g)).toHaveLength(2);
  });

  test("product creation and modification persist the entered TTC amount unchanged", () => {
    const products = source("actions/boutique/products.js");
    expect(products.match(/price: v\.price,/g)).toHaveLength(3);
    expect(products).not.toMatch(/price:\s*(?:applyVatRate|repriceTtcCataloguePrice)\(/);
    expect(products.match(/comparePrice: v\.comparePrice \?\? null,/g)).toHaveLength(3);
  });

  test("activity displays and bookings reprice the stored TTC amount", () => {
    const display = source("components/activities/ActivityPrice.jsx");
    expect(display).toContain("repriceTtcCataloguePrice(Number(priceTtc), vatRate)");

    for (const file of [
      "actions/workshops/create-workshop-reservation.js",
      "actions/formations/create-formation-reservation.js",
    ]) {
      expect(source(file)).toContain(
        "repriceTtcCataloguePrice(catalogueUnitPrice, vatPolicy.vatRate)"
      );
    }
  });
});
