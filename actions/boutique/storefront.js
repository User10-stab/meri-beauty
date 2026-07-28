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
    brand: product.brand ? { id: product.brand.id, name: product.brand.name } : null,
    category: product.subcategory.category,
    subcategory: { id: product.subcategory.id, name: product.subcategory.name },
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

/** Categories/subcategories/brands that actually have active products — for the filter sidebar. */
export async function getStorefrontFilters() {
  try {
    const [categories, brands] = await Promise.all([
      prisma.productCategory.findMany({
        where: { isActive: true, subcategories: { some: { products: { some: activeProductWhere } } } },
        orderBy: [{ position: "asc" }, { name: "asc" }],
        select: {
          id: true,
          name: true,
          slug: true,
          subcategories: {
            where: { isActive: true, products: { some: activeProductWhere } },
            orderBy: [{ position: "asc" }, { name: "asc" }],
            select: { id: true, name: true, slug: true },
          },
        },
      }),
      prisma.brand.findMany({
        where: { isActive: true, isDeleted: false, products: { some: activeProductWhere } },
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
      ...(brandId ? { brandId } : {}),
      ...(subcategorySlug
        ? { subcategory: { slug: subcategorySlug } }
        : categorySlug
        ? { subcategory: { category: { slug: categorySlug } } }
        : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: "insensitive" } },
              { brand: { name: { contains: search, mode: "insensitive" } } },
            ],
          }
        : {}),
    };

    const products = await prisma.product.findMany({
      where,
      orderBy: sort === "name" ? { name: "asc" } : { createdAt: "desc" },
      include: {
        brand: { select: { id: true, name: true } },
        subcategory: { select: { id: true, name: true, category: { select: { id: true, name: true, slug: true } } } },
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

export async function getStorefrontProductBySlug(slug) {
  if (!slug) return { success: false, message: "Produit introuvable." };

  try {
    const product = await prisma.product.findFirst({
      where: { slug, ...activeProductWhere },
      include: {
        brand: { select: { id: true, name: true } },
        subcategory: { select: { id: true, name: true, category: { select: { id: true, name: true, slug: true } } } },
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
        brand: product.brand,
        category: product.subcategory.category,
        subcategory: { id: product.subcategory.id, name: product.subcategory.name },
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
