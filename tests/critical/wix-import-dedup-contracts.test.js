import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseWixProductsCsv } from "../../lib/wixImport.js";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8");

// P0: re-running the Wix import (the normal workflow once Marie starts
// filling in barcodes on Wix, since they're rarely all present on the first
// export) must recognize a product it already imported and only backfill a
// missing barcode — never create a duplicate product, and never overwrite
// anything staff have since edited in the dashboard.
describe("Wix re-import backfills instead of duplicating", () => {
  const schema = source("prisma/schema.prisma");
  const importAction = source("actions/boutique/import.js");

  test("Product carries a stable, unique Wix handle to recognize a re-import", () => {
    expect(schema).toContain("wixHandle String? @unique");
  });

  test("runWixImport looks up the existing product by wixHandle before creating anything", () => {
    expect(importAction).toContain("where: { wixHandle: p.handle, isDeleted: false }");
    // The lookup must happen before any brand/category/subcategory/product
    // creation — otherwise a re-import would still create orphaned
    // brand/category rows even when it skips the product itself.
    const lookupIndex = importAction.indexOf("where: { wixHandle: p.handle, isDeleted: false }");
    const createIndex = importAction.indexOf("prisma.product.create");
    expect(lookupIndex).toBeGreaterThan(-1);
    expect(createIndex).toBeGreaterThan(lookupIndex);
  });

  test("a recognized re-import never creates a second product — it continues past the creation code", () => {
    expect(importAction).toContain("if (existing) {");
    expect(importAction).toContain("continue;");
  });

  test("the barcode backfill only fires when the existing variant has none and Wix now provides one", () => {
    expect(importAction).toContain("if (variant && !variant.barcode && p.barcode)");
  });

  test("newly created products are tagged with their Wix handle so a later re-import can find them", () => {
    expect(importAction).toContain("wixHandle: p.handle || null");
  });

  test("a barcode unique-constraint clash gets a readable message instead of a raw Prisma error", () => {
    expect(importAction).toContain('error.code === "P2002"');
    expect(importAction).toContain("Ce code-barres est déjà utilisé par un autre produit.");
  });

  test("the result reports created vs. updated counts separately", () => {
    expect(importAction).toContain("updatedCount: updatedIds.length");
  });
});

describe("Wix CSV barcode parsing (real export shape)", () => {
  test("reads the barcode column, not sku, and tolerates products with no barcode at all", () => {
    const csv = [
      "handle,fieldType,name,plainDescription,categorySlugs,primaryCategorySlug,price,cost,strikethroughPrice,inventory,sku,barcode",
      "h1,PRODUCT,Produit A,,tag,tag,10,5,,IN_STOCK,SKU-A,5600920741561",
      "h2,PRODUCT,Produit B,,tag,tag,12,6,,IN_STOCK,SKU-B,",
    ].join("\n");

    const products = parseWixProductsCsv(csv);
    expect(products).toHaveLength(2);
    expect(products.find((p) => p.handle === "h1").barcode).toBe("5600920741561");
    expect(products.find((p) => p.handle === "h2").barcode).toBeNull();
  });
});
