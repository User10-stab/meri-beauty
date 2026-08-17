import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolveProductClassification, summarizeSlugs } from "../../lib/wixImport.js";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8");

// P0: the review step's "these products need manual classification" warning
// only checked an unresolved category, never an unresolved brand. Against a
// real 175-product Wix export, 82 products (47%) resolved no brand at all
// (Wix's export has no native brand data — everything comes from a flat tag
// list the admin classifies by hand) while still resolving a real category,
// so the warning stayed completely silent about them and they were
// imported straight to "Non classé" with zero visibility before the import
// ran. That's what forced a full manual reclassification pass after import.
describe("the Wix import review warns about unclassified brand, not just category", () => {
  const importClient = source("components/dashboard/boutique/ImportWixClient.jsx");

  test("unclassifiedCount checks both brandName and categoryName", () => {
    expect(importClient).toContain("p.categoryName === t(\"unclassified\") || p.brandName === t(\"unclassified\")");
  });

  test("a product with a resolved category but no resolved brand is a real, reproducible case (not hypothetical)", () => {
    // Mirrors the exact shape hit in the real export: two tags, neither
    // recognized as a brand by the name-prefix heuristic, but one
    // recognized as a category.
    const product = {
      name: "Pierre roulée - Amazonite du Brésil",
      slugs: ["ésotérique", "pierres-roulées"],
      primarySlug: "ésotérique",
    };
    const slugMapping = { "ésotérique": "subcategory", "pierres-roulées": "subcategory" };
    const { brandName, categoryName } = resolveProductClassification(product, slugMapping);
    expect(brandName).toBeNull();
    expect(categoryName).toBe("Ésotérique");
  });
});
