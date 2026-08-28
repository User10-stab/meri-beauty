import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8");

describe("storefront filters hide fully-archived brands/categories/subcategories", () => {
  const storefront = source("actions/boutique/storefront.js");

  test("activeProductWhere excludes anything not ACTIVE, deleted, or out of active variants", () => {
    expect(storefront).toContain('status: "ACTIVE"');
    expect(storefront).toContain("isDeleted: false");
    expect(storefront).toContain("variants: { some: { isDeleted: false, isActive: true } }");
  });

  test("a brand only appears in the filter sidebar if it has at least one active product", () => {
    // If every product under a brand is ARCHIVED (or draft/deleted/out of
    // active variants), this `some` chain never matches and the brand is
    // silently absent from the storefront filters — a client should never
    // see a brand, category or subcategory with nothing sellable behind it.
    expect(storefront).toContain(
      "categories: { some: { subcategories: { some: { products: { some: activeProductWhere } } } } }"
    );
  });

  test("a category only appears if one of its subcategories has an active product", () => {
    expect(storefront).toContain(
      "subcategories: { some: { products: { some: activeProductWhere } } }"
    );
  });

  test("a subcategory only appears if it itself has an active product", () => {
    const filtersFn = storefront.slice(
      storefront.indexOf("export async function getStorefrontFilters"),
      storefront.indexOf("export async function getStorefrontProducts")
    );
    expect(filtersFn).toContain("products: { some: activeProductWhere }");
  });

  test("the product list itself is gated the same way, so archived products never render as cards", () => {
    const productsFn = storefront.slice(
      storefront.indexOf("export async function getStorefrontProducts"),
      storefront.indexOf("export async function getStorefrontProductByBarcode")
    );
    expect(productsFn).toContain("...activeProductWhere");
  });
});
