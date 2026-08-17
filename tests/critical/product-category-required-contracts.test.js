import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createProductSchema } from "../../lib/validations/boutique.js";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8");

// P0: every product must still belong to a real Marque/Catégorie (client
// decision, 17 Aug 2026 — Marie doesn't want products with no brand/category
// at all, which is what happened when subcategory alone was made optional).
// A specific Sous-catégorie stays optional and falls back to that category's
// "Général" catch-all instead of blocking the save.
describe("a product always resolves to a real category, subcategory is optional", () => {
  const productsAction = source("actions/boutique/products.js");
  const importAction = source("actions/boutique/import.js");
  const generalSubcategoryLib = source("lib/boutique/general-subcategory.js");

  test("categoryId is required by the schema", () => {
    const variant = { name: "Standard", sku: "SKU-1", price: "10", costPrice: "5" };
    const missingCategory = createProductSchema.safeParse({ name: "Produit", status: "DRAFT", variants: [variant] });
    expect(missingCategory.success).toBe(false);
    expect(missingCategory.error.flatten().fieldErrors.categoryId).toBeTruthy();

    const withCategory = createProductSchema.safeParse({ name: "Produit", categoryId: "cat1", status: "DRAFT", variants: [variant] });
    expect(withCategory.success).toBe(true);
  });

  test("subcategoryId is not required by the schema", () => {
    const variant = { name: "Standard", sku: "SKU-1", price: "10", costPrice: "5" };
    const result = createProductSchema.safeParse({ name: "Produit", categoryId: "cat1", status: "ACTIVE", variants: [variant] });
    expect(result.success).toBe(true);
  });

  test("createProduct/updateProduct resolve a blank subcategory to the category's Général bucket, never leave it null", () => {
    expect(productsAction).toContain("resolveSubcategoryId(categoryId, submittedSubcategoryId)");
    expect(productsAction).toContain("getOrCreateGeneralSubcategory(categoryId)");
  });

  test("a submitted subcategoryId is checked against the chosen category, not trusted blindly", () => {
    expect(productsAction).toContain("subcategory.categoryId !== categoryId");
  });

  test("the Wix importer shares the exact same Général fallback (no divergent duplicate logic)", () => {
    expect(importAction).toContain("getOrCreateGeneralSubcategory(categoryId)");
    expect(importAction).not.toContain('name: "Général", categoryId');
  });

  test("the Général subcategory is scoped uniquely per category, matching the schema's @@unique([categoryId, slug])", () => {
    expect(generalSubcategoryLib).toContain("findFirst({ where: { slug, categoryId }");
  });
});
