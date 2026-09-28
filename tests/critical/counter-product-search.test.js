import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  barcodeLookupCandidates,
  buildSearchEntry,
  editDistance,
  isInternalBarcode,
  isValidGtin,
  linkableBarcodeError,
  looksLikeProductGtin,
  normalizeSearchText,
  rankSearchEntries,
  tokenizeSearchQuery,
} from "@/lib/counter/product-search";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8");

const catalogue = [
  { id: "hydra", productName: "Crème Hydratante Visage", variantName: "50 ml", brandName: "Lashme", categoryNames: ["Soins", "Crèmes"], sku: "LM-HYD-50" },
  { id: "hydra-100", productName: "Crème Hydratante Visage", variantName: "100 ml", brandName: "Lashme", categoryNames: ["Soins", "Crèmes"], sku: "LM-HYD-100" },
  { id: "mains", productName: "Crème Mains Karité", variantName: "Standard", brandName: "Nailova", categoryNames: ["Soins"], sku: "NV-KAR" },
  { id: "gel-rose", productName: "Gel Polish Rose Gold", variantName: "Teinte 03", brandName: "Nailova", categoryNames: ["Vernis"], sku: "NV-GP-03", barcode: "4820241061136" },
  { id: "gel-nude", productName: "Gel Polish Nude", variantName: "Teinte 12", brandName: "Nailova", categoryNames: ["Vernis"], sku: "NV-GP-12" },
  { id: "serum", productName: "Sérum Anti-âge", variantName: "Standard", brandName: "Lashme", categoryNames: ["Soins"], sku: "LM-SER" },
].map((row) => ({ id: row.id, searchEntry: buildSearchEntry(row) }));

const search = (query) => rankSearchEntries(catalogue, query).sort((a, b) => b.score - a.score).map((row) => row.item.id);

describe("counter product search — forgiving matching", () => {
  test("normalises accents, ligatures and punctuation", () => {
    expect(normalizeSearchText("Crème  Anti-âge — Œillet")).toBe("creme anti age oeillet");
    expect(tokenizeSearchQuery("l'huile a 3")).toEqual(["huile", "3"]);
  });

  test("finds a product without its accents", () => {
    expect(search("creme hydratante")).toEqual(expect.arrayContaining(["hydra", "hydra-100"]));
    expect(search("serum")).toEqual(["serum"]);
  });

  test("matches every word, in any order, by prefix", () => {
    expect(search("hydra creme")).toEqual(expect.arrayContaining(["hydra", "hydra-100"]));
    expect(search("hydra creme")).not.toContain("mains");
    expect(search("creme mains")).toEqual(["mains"]);
  });

  test("tolerates a typo or a swapped letter", () => {
    expect(search("hidratante")).toEqual(expect.arrayContaining(["hydra", "hydra-100"]));
    expect(search("karitr")).toEqual(["mains"]);
    expect(search("polihs")).toEqual(expect.arrayContaining(["gel-rose", "gel-nude"]));
  });

  test("uses the variant, the brand and the joined spelling", () => {
    expect(search("hydratante 100")[0]).toBe("hydra-100");
    expect(search("nailova nude")).toEqual(["gel-nude"]);
    expect(search("rosegold")).toEqual(["gel-rose"]);
    expect(search("antiage")).toEqual(["serum"]);
  });

  test("a number matches a shade or size, never the middle of another number", () => {
    expect(search("gel 3")).toEqual(["gel-rose"]);
    expect(search("hydratante 5")).toEqual(["hydra"]);
    expect(search("hydratante 00")).toEqual([]);
  });

  test("finds a variant by SKU or barcode", () => {
    expect(search("NV-GP-12")[0]).toBe("gel-nude");
    expect(search("4820241061136")).toEqual(["gel-rose"]);
  });

  test("the Standard placeholder is not searchable", () => {
    expect(search("standard")).toEqual([]);
  });

  test("returns nothing for an unrelated word", () => {
    expect(search("shampoing")).toEqual([]);
  });

  test("editDistance counts a transposition as one edit", () => {
    expect(editDistance("hydra", "hdyra")).toBe(1);
    expect(editDistance("abc", "abcdef", 2)).toBe(3);
  });
});

describe("counter barcode learning — code rules", () => {
  test("validates the GS1 check digit", () => {
    expect(isValidGtin("4820241061136")).toBe(true);
    expect(isValidGtin("4820241061137")).toBe(false);
    expect(isValidGtin("036000291452")).toBe(true); // UPC-A
    expect(isValidGtin("96385074")).toBe(true); // EAN-8
  });

  test("looks a UPC-A up as its EAN-13 / GTIN-14 form and back", () => {
    expect(barcodeLookupCandidates("102121500251")).toEqual(
      expect.arrayContaining(["102121500251", "0102121500251", "00102121500251"])
    );
    expect(barcodeLookupCandidates("0102121500251")).toContain("102121500251");
    expect(barcodeLookupCandidates("96385074")).toEqual(["96385074"]);
    expect(barcodeLookupCandidates("ABC-123")).toEqual(["ABC-123"]);
  });

  test("recognises the editor's generated internal code", () => {
    expect(isInternalBarcode("INFD2DBA838A")).toBe(true);
    expect(isInternalBarcode("4820241061136")).toBe(false);
  });

  test("refuses codes that must never be linked to a product", () => {
    expect(linkableBarcodeError("4820241061136")).toBeNull();
    expect(linkableBarcodeError("4820241061137")).toMatch(/contrôle/);
    expect(linkableBarcodeError("INFD2DBA838A")).toMatch(/interne/);
    expect(linkableBarcodeError("R-0A1B2C3D4E")).toMatch(/réservation/);
    expect(linkableBarcodeError("AB12CD34")).toMatch(/réservation/);
    expect(linkableBarcodeError("S:clxyz123")).not.toBeNull();
    expect(linkableBarcodeError("123")).not.toBeNull();
  });

  test("only a valid EAN-13/UPC-A read by the omnibar camera is routed to the till", () => {
    expect(looksLikeProductGtin("4820241061136")).toBe(true);
    expect(looksLikeProductGtin("4820241061137")).toBe(false);
    expect(looksLikeProductGtin("12345670")).toBe(false); // 8 digits = also a check-in code
  });
});

describe("counter barcode learning — server contracts", () => {
  const pos = source("actions/boutique/point-of-sale.js");

  test("an unknown scan is reported as linkable, not a dead end", () => {
    expect(pos).toContain('code: "BARCODE_UNKNOWN"');
    expect(pos).toContain("barcode: { in: barcodeLookupCandidates(code) }");
  });

  test("linking is gated, never overwrites a supplier code, never steals one, and is audited", () => {
    const link = pos.slice(pos.indexOf("export async function linkPointOfSaleBarcode"));
    expect(link).toContain("await requirePointOfSaleAccess()");
    expect(link).toContain("linkableBarcodeError(code)");
    expect(link).toContain("variant.barcode && !isInternalBarcode(variant.barcode)");
    expect(link).toContain('"POS_LINK_BARCODE_TAKEN"');
    expect(link).toContain('action: "product_variant.barcode_linked_at_counter"');
  });

  test("search keeps the sellable-only filters and never ships cost prices", () => {
    const searchFn = pos.slice(pos.indexOf("export async function searchPointOfSaleProducts"));
    const body = searchFn.slice(0, searchFn.indexOf("\n}\n"));
    expect(body).toContain('product: { isDeleted: false, status: "ACTIVE" }');
    expect(body).not.toContain("costPrice");
    expect(body).not.toContain("comparePrice");
    expect(body).toContain("rankSearchEntries(");
  });
});

describe("till photo grid — only sells what is in stock, live", () => {
  const pos = source("actions/boutique/point-of-sale.js");
  const catalogue = source("components/dashboard/boutique/counter/CounterCatalogue.jsx");
  const cart = source("components/dashboard/boutique/counter/CounterCart.jsx");

  test("an out-of-stock product or variant is never offered for sale", () => {
    expect(catalogue).not.toContain("En stock uniquement");
    expect(catalogue).toContain("if (!linkBarcode && availableOf(product) <= 0) return false;");
    expect(catalogue).toContain("product.variants.filter((variant) => variant.availableQuantity > 0)");
  });

  test("the grid refreshes itself so a unit sold online drops out", () => {
    expect(catalogue).toContain("REFRESH_INTERVAL_MS");
    expect(catalogue).toContain('window.addEventListener("focus", onFocus)');
  });

  test("live stock is guarded and counts reservations", () => {
    const levels = pos.slice(pos.indexOf("export async function getPointOfSaleStockLevels"));
    expect(levels).toContain("await requirePointOfSaleAccess()");
    expect(levels).toContain("Math.max(0, variant.stockQuantity - variant.reservedQuantity)");
  });

  test("a tap re-reads live stock, the cart is re-checked, and payment waits for a clean cart", () => {
    expect(cart).toContain("onAdd={addFromCatalogue}");
    expect(cart).toContain("await getPointOfSaleStockLevels([item.variantId])");
    expect(cart).toContain("CART_STOCK_POLL_MS");
    // A QR checkout reserves its own units — polling then would flag them.
    expect(cart).toContain("if (!cartVariantKey || qrModal) return undefined;");
    expect(cart).toContain("stockConflicts.length > 0 ||");
    // A taken-over pickup order's reserved units belong to that line.
    expect(cart).toContain("heldQuantity: item.quantity");
  });

  test("the last unit can still never be sold twice: payment locks and re-checks the row", () => {
    expect(pos).toContain('await tx.$queryRaw`SELECT id FROM "ProductVariant" WHERE id = ${variantId} FOR UPDATE`');
    expect(pos).toContain("const available = variant.stockQuantity - variant.reservedQuantity;");
  });
});
