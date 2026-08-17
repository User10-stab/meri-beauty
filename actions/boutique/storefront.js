"use server";

import { prisma } from "@/lib/prisma";

/**
 * Customer-facing catalogue reads. Deliberately separate from
 * actions/boutique/products.js: that module is dashboard-only (requireAdmin,
 * includes costPrice/margin) and its withMargin() output would leak cost and
 * profit data straight into the storefront if reused here. Everything below
 * only ever selects/returns customer-safe fields, and only ever surfaces
 * ACTIVE, non-deleted products with at least one active, non-deleted variant.
 */

function serializeCard(product) {
  const prices = product.variants.map((v) => Number(v.price));
  const compareValues = product.variants.map((v) => (v.comparePrice != null ? Number(v.comparePrice) : null));
  const totalAvailable = product.variants.reduce(
    (sum, v) => sum + Math.max(v.stockQuantity - v.reservedQuantity, 0),
    0
  );

  return {
    id: product.id,
    name: product.name,
    slug: product.slug,
    // A product can be ACTIVE with no subcategory (client decision, 17 Aug
    // 2026 — see lib/validations/boutique.js) — never assume the chain
    // resolves.
    brand: product.subcategory ? { id: product.subcategory.category.brand.id, name: product.subcategory.category.brand.name } : null,
    category: product.subcategory ? { id: product.subcategory.category.id, name: product.subcategory.category.name } : null,
    subcategory: product.subcategory ? { id: product.subcategory.id, name: product.subcategory.name } : null,
    image: product.images[0]?.path ?? null,
    priceFrom: Math.min(...prices),
    comparePriceFrom: compareValues.some((v) => v != null) ? Math.min(...compareValues.filter((v) => v != null)) : null,
    inStock: totalAvailable > 0,
  };
}

const activeProductWhere = {
  isDeleted: false,
  status: "ACTIVE",
  variants: { some: { isDeleted: false, isActive: true } },
};

/**
 * Categories/subcategories/brands that actually have active products — for the
 * filter sidebar. Categories are brand-scoped (a name like "Accessoires" or
 * "Non classé" legitimately recurs under several different brands), so each
 * category carries its brand here — the sidebar groups by brand instead of
 * showing a flat list where the same name appears several times with no way
 * to tell them apart.
 */
export async function getStorefrontFilters() {
  try {
    const [categories, brands] = await Promise.all([
      prisma.productCategory.findMany({
        where: { isActive: true, subcategories: { some: { products: { some: activeProductWhere } } } },
        orderBy: [{ brand: { name: "asc" } }, { position: "asc" }, { name: "asc" }],
        select: {
          id: true,
          name: true,
          slug: true,
          brand: { select: { id: true, name: true } },
          subcategories: {
            // "Général" is the auto-created catch-all subcategory for
            // products that haven't been organized further — an
            // implementation detail, not a real filter customers should see.
            // Excluded here (not just in the sidebar component) so every
            // consumer of this action — breadcrumbs, a category landing
            // page, an API — gets the same rule for free.
            where: { isActive: true, name: { not: "Général" }, products: { some: activeProductWhere } },
            orderBy: [{ position: "asc" }, { name: "asc" }],
            select: { id: true, name: true, slug: true },
          },
        },
      }),
      prisma.brand.findMany({
        where: {
          isActive: true,
          isDeleted: false,
          categories: { some: { subcategories: { some: { products: { some: activeProductWhere } } } } },
        },
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      }),
    ]);

    return { success: true, data: { categories, brands } };
  } catch (error) {
    console.error("[getStorefrontFilters]", error);
    return { success: false, message: "Impossible de charger les filtres.", data: { categories: [], brands: [] } };
  }
}

export async function getStorefrontProducts({
  search,
  categorySlug,
  subcategorySlug,
  brandId,
  sort = "newest",
} = {}) {
  try {
    const where = {
      ...activeProductWhere,
      ...(subcategorySlug
        ? { subcategory: { slug: subcategorySlug } }
        : categorySlug
        ? { subcategory: { category: { slug: categorySlug } } }
        : brandId
        ? { subcategory: { category: { brandId } } }
        : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: "insensitive" } },
              { subcategory: { category: { brand: { name: { contains: search, mode: "insensitive" } } } } },
            ],
          }
        : {}),
    };

    const products = await prisma.product.findMany({
      where,
      orderBy: sort === "name" ? { name: "asc" } : { createdAt: "desc" },
      include: {
        subcategory: {
          select: {
            id: true,
            name: true,
            category: { select: { id: true, name: true, slug: true, brand: { select: { id: true, name: true } } } },
          },
        },
        variants: { where: { isDeleted: false, isActive: true }, select: { price: true, comparePrice: true, stockQuantity: true, reservedQuantity: true } },
        images: { where: { isPrimary: true }, take: 1, select: { path: true } },
      },
    });

    let cards = products.map(serializeCard);
    if (sort === "price-asc") cards = cards.sort((a, b) => a.priceFrom - b.priceFrom);
    if (sort === "price-desc") cards = cards.sort((a, b) => b.priceFrom - a.priceFrom);

    return { success: true, data: cards };
  } catch (error) {
    console.error("[getStorefrontProducts]", error);
    return { success: false, message: "Impossible de charger les produits.", data: [] };
  }
}

/**
 * In-store self-scan: resolve a scanned EAN/UPC barcode to a product +
 * variant. Returns enough to render an inline confirm card (name, image,
 * price, stock) so the scan page can offer "Add to cart" / "Cancel" without
 * navigating away — the customer may be scanning several items in a row.
 */
export async function getStorefrontProductByBarcode(barcode) {
  const cleaned = (barcode ?? "").trim();
  if (!cleaned) return { success: false, message: "Code-barres introuvable." };

  try {
    const variant = await prisma.productVariant.findFirst({
      where: { barcode: cleaned, isDeleted: false, isActive: true, product: activeProductWhere },
      select: {
        id: true,
        name: true,
        price: true,
        comparePrice: true,
        stockQuantity: true,
        reservedQuantity: true,
        product: {
          select: {
            slug: true,
            name: true,
            images: { where: { isPrimary: true }, take: 1, select: { path: true } },
          },
        },
      },
    });

    if (!variant) return { success: false, message: "Aucun produit ne correspond à ce code-barres." };

    return {
      success: true,
      data: {
        slug: variant.product.slug,
        variantId: variant.id,
        productName: variant.product.name,
        variantName: variant.name,
        image: variant.product.images[0]?.path ?? null,
        price: Number(variant.price),
        comparePrice: variant.comparePrice != null ? Number(variant.comparePrice) : null,
        availableQuantity: Math.max(variant.stockQuantity - variant.reservedQuantity, 0),
      },
    };
  } catch (error) {
    console.error("[getStorefrontProductByBarcode]", error);
    return { success: false, message: "Impossible de rechercher ce produit." };
  }
}

export async function getStorefrontProductBySlug(slug) {
  if (!slug) return { success: false, message: "Produit introuvable." };

  try {
    const product = await prisma.product.findFirst({
      where: { slug, ...activeProductWhere },
      include: {
        subcategory: {
          select: {
            id: true,
            name: true,
            category: { select: { id: true, name: true, slug: true, brand: { select: { id: true, name: true } } } },
          },
        },
        variants: {
          where: { isDeleted: false, isActive: true },
          orderBy: { position: "asc" },
          select: {
            id: true,
            name: true,
            sku: true,
            price: true,
            comparePrice: true,
            stockQuantity: true,
            reservedQuantity: true,
          },
        },
        images: { orderBy: { position: "asc" }, select: { path: true, alt: true, isPrimary: true } },
      },
    });

    if (!product) return { success: false, message: "Ce produit n'est plus disponible." };

    return {
      success: true,
      data: {
        id: product.id,
        name: product.name,
        slug: product.slug,
        description: product.description,
        // A product can be ACTIVE with no subcategory (client decision, 17
        // Aug 2026) — never assume the chain resolves.
        brand: product.subcategory?.category.brand ?? null,
        category: product.subcategory
          ? { id: product.subcategory.category.id, name: product.subcategory.category.name, slug: product.subcategory.category.slug }
          : null,
        subcategory: product.subcategory ? { id: product.subcategory.id, name: product.subcategory.name } : null,
        images: product.images.map((img) => ({ path: img.path, alt: img.alt })),
        variants: product.variants.map((v) => ({
          id: v.id,
          name: v.name,
          sku: v.sku,
          price: Number(v.price),
          comparePrice: v.comparePrice != null ? Number(v.comparePrice) : null,
          availableQuantity: Math.max(v.stockQuantity - v.reservedQuantity, 0),
        })),
      },
    };
  } catch (error) {
    console.error("[getStorefrontProductBySlug]", error);
    return { success: false, message: "Impossible de charger ce produit." };
  }
}
