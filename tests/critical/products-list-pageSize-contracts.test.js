import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8");

// P0: the dashboard products page fetched only the first 50 products
// (getProducts's own default is 20) and ProductsPageClient has no
// pagination UI at all — it filters entirely client-side over whatever it
// was handed. A 175-product Wix import silently only showed 50 of them,
// with nothing telling staff that 125 products existed but were invisible —
// this read exactly like "not all the products got imported" even though
// the import itself succeeded completely.
describe("the products list fetches enough products to show the whole catalogue", () => {
  const page = source("app/dashboard/boutique/products/page.jsx");
  const client = source("components/dashboard/boutique/ProductsPageClient.jsx");

  test("the page requests a pageSize comfortably above a realistic catalogue size, not the old 50", () => {
    const match = page.match(/getProducts\(\{\s*pageSize:\s*(\d+)\s*\}\)/);
    expect(match).not.toBeNull();
    expect(Number(match[1])).toBeGreaterThanOrEqual(500);
  });

  test("the product count is visible in the UI, so a cap being hit again would be noticeable", () => {
    expect(client).toContain("initialProducts.length");
  });
});
