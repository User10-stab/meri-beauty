import { z } from "zod";
import { formBoolean } from "@/lib/validations/boolean";

/**
 * Validation schemas for the boutique catalogue.
 *
 * Money is validated as a number here and written to Decimal(10,2) columns.
 * profit and margin are never accepted as input — both are derived from
 * (price - costPrice) at read time.
 */

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Builds a URL-safe slug from a name.
 * "Shampooing Hydratant 250ml" → "shampooing-hydratant-250ml"
 */
export function slugify(value) {
  return String(value)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip accents
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

const name = (label, max = 100) =>
  z
    .string({ error: `${label} est obligatoire.` })
    .trim()
    .min(2, `${label} doit contenir au moins 2 caractères.`)
    .max(max, `${label} ne peut pas dépasser ${max} caractères.`);

const description = z
  .string()
  .trim()
  .optional()
  .nullable();

const money = (label) =>
  z.coerce
    .number({ error: `${label} est invalide.` })
    .nonnegative(`${label} ne peut pas être négatif.`)
    .max(99999999, `${label} est trop élevé.`);

const wholeNumber = (label) =>
  z.coerce
    .number({ error: `${label} est invalide.` })
    .int(`${label} doit être un nombre entier.`)
    .nonnegative(`${label} ne peut pas être négatif.`);

// ─── Brand ────────────────────────────────────────────────────────────────────

export const createBrandSchema = z.object({
  name: name("Le nom de la marque"),
  description,
  logo: z.string().trim().optional().nullable(),
  isActive: formBoolean(true),
});

export const updateBrandSchema = createBrandSchema.extend({
  id: z.string().min(1, "L'identifiant de la marque est obligatoire."),
});

// ─── Category / Subcategory ───────────────────────────────────────────────────

export const createProductCategorySchema = z.object({
  name: name("Le nom de la catégorie"),
  brandId: z
    .string({ error: "La marque est obligatoire." })
    .min(1, "La marque est obligatoire."),
  description,
  position: wholeNumber("La position").optional().default(0),
  isActive: formBoolean(true),
});

export const updateProductCategorySchema = createProductCategorySchema.extend({
  id: z.string().min(1, "L'identifiant de la catégorie est obligatoire."),
});

export const createProductSubcategorySchema = z.object({
  name: name("Le nom de la sous-catégorie"),
  categoryId: z
    .string({ error: "La catégorie est obligatoire." })
    .min(1, "La catégorie est obligatoire."),
  position: wholeNumber("La position").optional().default(0),
  isActive: formBoolean(true),
});

export const updateProductSubcategorySchema = createProductSubcategorySchema.extend({
  id: z.string().min(1, "L'identifiant de la sous-catégorie est obligatoire."),
});

// ─── Variant ──────────────────────────────────────────────────────────────────

/**
 * A variant is the sellable unit. Products with a single size still get one
 * variant, named "Standard" by default.
 */
export const variantSchema = z
  .object({
    id: z.string().optional().nullable(), // present when updating an existing variant
    name: z
      .string()
      .trim()
      .min(1, "Le nom de la déclinaison est obligatoire.")
      .max(60, "Le nom ne peut pas dépasser 60 caractères.")
      .default("Standard"),
    sku: z
      .string({ error: "La référence (SKU) est obligatoire." })
      .trim()
      .min(1, "La référence (SKU) est obligatoire.")
      .max(60, "La référence ne peut pas dépasser 60 caractères."),
    barcode: z
      .string()
      .trim()
      .max(60, "Le code-barres ne peut pas dépasser 60 caractères.")
      .optional()
      .nullable()
      .transform((v) => (v === "" ? null : v)),

    price: money("Le prix de vente"),
    costPrice: money("Le prix d'achat"),
    comparePrice: money("Le prix barré").optional().nullable(),

    stockQuantity: wholeNumber("Le stock").optional().default(0),
    lowStockThreshold: wholeNumber("Le seuil de stock bas").optional().default(3),
    // Left optional (client decision, 17 Aug 2026): Wix's export never
    // carries a weight, and Marie has no way to add one on Wix's side —
    // making it mandatory blocked every imported product from being saved
    // at all. Falls back to 0, which `calculateShippingCost` (see
    // lib/shipping.js) treats as "fits the cheapest weight tier" — an
    // accepted undercharging risk on unweighed products until staff fill
    // in the real figure.
    weightGrams: z.preprocess(
      (v) => (v === "" ? undefined : v),
      z.coerce
        .number({ error: "Le poids est invalide." })
        .int("Le poids doit être un nombre entier.")
        .nonnegative("Le poids ne peut pas être négatif.")
        .optional()
        .default(0)
    ),

    position: wholeNumber("La position").optional().default(0),
    isActive: formBoolean(true),
  })
  .superRefine((data, ctx) => {
    // A struck-through price that isn't above the selling price is meaningless
    // to a customer and usually signals a data-entry mistake.
    if (data.comparePrice != null && data.comparePrice > 0 && data.comparePrice <= data.price) {
      ctx.addIssue({
        path: ["comparePrice"],
        code: z.ZodIssueCode.custom,
        message: "Le prix barré doit être supérieur au prix de vente.",
      });
    }
  });

// ─── Product ──────────────────────────────────────────────────────────────────

// Every product still needs a real Marque/Catégorie (client decision, 17 Aug
// 2026 — Marie doesn't want products floating with no brand/category at
// all), but the specific Sous-catégorie underneath is optional: leaving it
// blank resolves to that category's catch-all "Général" bucket (see
// lib/boutique/general-subcategory.js) instead of blocking the save — the
// same fallback the Wix importer already used for tags with no clean match.
export const createProductSchema = z.object({
  name: name("Le nom du produit", 150),
  description,
  // Only used server-side to resolve/create the "Général" subcategory when
  // subcategoryId is left blank — never stored directly on Product (brand
  // and category are always derived via subcategory.category, so a product
  // always belongs to a real category one way or another).
  categoryId: z
    .string({ error: "La catégorie est obligatoire." })
    .trim()
    .min(1, "La catégorie est obligatoire."),
  subcategoryId: z
    .string()
    .trim()
    .optional()
    .nullable()
    .transform((v) => (v === "" ? null : v)),
  status: z.enum(["DRAFT", "ACTIVE", "ARCHIVED"]).optional().default("DRAFT"),
  variants: z
    .array(variantSchema)
    .min(1, "Le produit doit avoir au moins une déclinaison.")
    .default([{ name: "Standard" }]),
  images: z
    .array(
      z.object({
        path: z.string().min(1),
        alt: z.string().trim().max(150).optional().nullable(),
        position: wholeNumber("La position").optional().default(0),
        isPrimary: formBoolean(false),
      })
    )
    .optional()
    .default([]),
});

export const updateProductSchema = createProductSchema.extend({
  id: z.string().min(1, "L'identifiant du produit est obligatoire."),
});

// ─── Stock adjustment ─────────────────────────────────────────────────────────

/**
 * Manual stock movements. SALE and RETURN are written by the order flow, not
 * by hand, so they are excluded here.
 */
export const stockAdjustmentSchema = z.object({
  variantId: z.string().min(1, "La déclinaison est obligatoire."),
  type: z.enum(["RESTOCK", "LOSS", "ADJUSTMENT", "SALON_USAGE"], {
    error: "Le type de mouvement est obligatoire.",
  }),
  /**
   * Always a positive count — direction comes from `type`. Asking staff to type
   * a negative number is how you get accidental double-negatives.
   */
  quantity: z.coerce
    .number({ error: "La quantité est invalide." })
    .int("La quantité doit être un nombre entier.")
    .positive("La quantité doit être supérieure à zéro."),
  reason: z
    .string()
    .trim()
    .optional()
    .nullable(),
});

/**
 * ADJUSTMENT sets an absolute count rather than applying a delta — used when
 * someone counts the shelf and the system disagrees.
 */
export const stockCountSchema = z.object({
  variantId: z.string().min(1, "La déclinaison est obligatoire."),
  countedQuantity: wholeNumber("La quantité comptée"),
  reason: z
    .string()
    .trim()
    .optional()
    .nullable(),
});
