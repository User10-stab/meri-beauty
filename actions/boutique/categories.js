"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { isAdminRole } from "@/lib/authorization";
import {
  createProductCategorySchema,
  updateProductCategorySchema,
  createProductSubcategorySchema,
  updateProductSubcategorySchema,
  slugify,
} from "@/lib/validations/boutique";

/**
 * Product category / subcategory management.
 *
 * Separate from Category/Service — that model is service-only. Retail
 * products classify under Brand → ProductCategory → ProductSubcategory
 * instead (client decision, 29 Jul 2026 — a category belongs to exactly one
 * brand; the same category name can recur under different brands as
 * separate rows, since brandId+slug is what's actually unique, not slug
 * alone).
 */

async function requireAdmin() {
  const session = await auth();
  if (!session?.user) return { error: "Non authentifié." };
  if (!isAdminRole(session.user.role)) return { error: "Accès non autorisé." };
  return { session };
}

async function uniqueCategorySlug(brandId, base, excludeId = null) {
  let slug = base;
  let n = 1;

  while (true) {
    const clash = await prisma.productCategory.findFirst({ where: { brandId, slug }, select: { id: true } });
    if (!clash || clash.id === excludeId) return slug;
    n += 1;
    slug = `${base}-${n}`;
  }
}

// ─── Read ─────────────────────────────────────────────────────────────────────

/** Categories for one brand — used by the product editor's cascading selects. */
export async function getProductCategories({ brandId, includeInactive = false } = {}) {
  if (!brandId) return { success: false, message: "La marque est obligatoire.", data: [] };

  try {
    const categories = await prisma.productCategory.findMany({
      where: { brandId, ...(includeInactive ? {} : { isActive: true }) },
      orderBy: [{ position: "asc" }, { name: "asc" }],
      include: {
        subcategories: {
          where: includeInactive ? {} : { isActive: true },
          orderBy: [{ position: "asc" }, { name: "asc" }],
          include: { _count: { select: { products: true } } },
        },
      },
    });

    return {
      success: true,
      data: categories.map((c) => ({
        id: c.id,
        name: c.name,
        slug: c.slug,
        description: c.description,
        position: c.position,
        isActive: c.isActive,
        brandId: c.brandId,
        subcategories: c.subcategories.map((s) => ({
          id: s.id,
          name: s.name,
          slug: s.slug,
          position: s.position,
          isActive: s.isActive,
          productCount: s._count.products,
        })),
      })),
    };
  } catch (error) {
    console.error("[getProductCategories]", error);
    return { success: false, message: "Impossible de charger les catégories.", data: [] };
  }
}

/**
 * Full tree for the "Catégories" dashboard page: every brand, with its
 * categories and their subcategories nested underneath — the whole
 * Brand → Category → Subcategory shape in one read.
 */
export async function getCatalogueTree({ includeInactive = false, includeProducts = false } = {}) {
  try {
    const brands = await prisma.brand.findMany({
      where: { isDeleted: false, ...(includeInactive ? {} : { isActive: true }) },
      orderBy: { name: "asc" },
      include: {
        categories: {
          where: includeInactive ? {} : { isActive: true },
          orderBy: [{ position: "asc" }, { name: "asc" }],
          include: {
            subcategories: {
              where: includeInactive ? {} : { isActive: true },
              orderBy: [{ position: "asc" }, { name: "asc" }],
              include: {
                _count: { select: { products: true } },
                ...(includeProducts ? {
                  products: {
                    where: { isDeleted: false },
                    select: {
                      id: true,
                      name: true,
                      slug: true,
                      status: true,
                      images: { orderBy: { position: "asc" }, take: 1, select: { path: true } },
                      variants: {
                      where: { isDeleted: false, isActive: true },
                      select: {
                        id: true,
                        name: true,
                        price: true,
                        comparePrice: true,
                        stockQuantity: true,
                        reservedQuantity: true
                      },
                      orderBy: { position: 'asc' }
                    }
                    },
                    orderBy: { name: 'asc' }
                  }
                } : {})
              },
            },
          },
        },
      },
    });

    return {
      success: true,
      data: brands.map((b) => ({
        id: b.id,
        name: b.name,
        slug: b.slug,
        isActive: b.isActive,
        categories: b.categories.map((c) => ({
          id: c.id,
          name: c.name,
          slug: c.slug,
          description: c.description,
          position: c.position,
          isActive: c.isActive,
          subcategories: c.subcategories.map((s) => ({
            id: s.id,
            name: s.name,
            slug: s.slug,
            position: s.position,
            isActive: s.isActive,
            productCount: s._count.products,
            products: includeProducts
              ? (s.products || []).map((p) => ({
                  id: p.id,
                  name: p.name,
                  slug: p.slug,
                  status: p.status,
                  thumbnail: p.images[0]?.path ?? null,
                  variants: p.variants.map((v) => ({
                    ...v,
                    price: Number(v.price),
                    comparePrice: v.comparePrice != null ? Number(v.comparePrice) : null,
                  })),
                }))
              : undefined,
          })),
        })),
      })),
    };
  } catch (error) {
    console.error("[getCatalogueTree]", error);
    return { success: false, message: "Impossible de charger le catalogue.", data: [] };
  }
}

// ─── Category CRUD ──────────────────────────────────────────────────────────────

export async function createProductCategory(input) {
  const guard = await requireAdmin();
  if (guard.error) return { success: false, message: guard.error };

  const parsed = createProductCategorySchema.safeParse(input);
  if (!parsed.success) {
    const errors = parsed.error.flatten().fieldErrors;
    return {
      success: false,
      message: errors.name?.[0] ?? errors.brandId?.[0] ?? "Données invalides.",
      errors: { name: errors.name?.[0] ?? null, brandId: errors.brandId?.[0] ?? null },
    };
  }

  const { name, brandId, description, position, isActive } = parsed.data;

  try {
    const brand = await prisma.brand.findUnique({ where: { id: brandId }, select: { id: true } });
    if (!brand) {
      return { success: false, message: "Marque introuvable.", errors: { brandId: "Marque introuvable." } };
    }

    const duplicate = await prisma.productCategory.findFirst({
      where: { brandId, name: { equals: name, mode: "insensitive" } },
      select: { id: true },
    });
    if (duplicate) {
      return {
        success: false,
        message: "Cette marque a déjà une catégorie portant ce nom.",
        errors: { name: "Ce nom est déjà utilisé pour cette marque." },
      };
    }

    const category = await prisma.productCategory.create({
      data: {
        name,
        brandId,
        slug: await uniqueCategorySlug(brandId, slugify(name)),
        description: description ?? null,
        position,
        isActive,
      },
    });

    revalidatePath("/dashboard/boutique/categories");
    return { success: true, message: "Catégorie créée.", data: category };
  } catch (error) {
    console.error("[createProductCategory]", error);
    return { success: false, message: "Impossible de créer la catégorie." };
  }
}

export async function updateProductCategory(input) {
  const guard = await requireAdmin();
  if (guard.error) return { success: false, message: guard.error };

  const parsed = updateProductCategorySchema.safeParse(input);
  if (!parsed.success) {
    const errors = parsed.error.flatten().fieldErrors;
    return {
      success: false,
      message: errors.name?.[0] ?? errors.brandId?.[0] ?? "Données invalides.",
      errors: { name: errors.name?.[0] ?? null, brandId: errors.brandId?.[0] ?? null },
    };
  }

  const { id, name, brandId, description, position, isActive } = parsed.data;

  try {
    const existing = await prisma.productCategory.findUnique({ where: { id } });
    if (!existing) return { success: false, message: "Catégorie introuvable." };

    const duplicate = await prisma.productCategory.findFirst({
      where: { brandId, name: { equals: name, mode: "insensitive" }, id: { not: id } },
      select: { id: true },
    });
    if (duplicate) {
      return {
        success: false,
        message: "Cette marque a déjà une catégorie portant ce nom.",
        errors: { name: "Ce nom est déjà utilisé pour cette marque." },
      };
    }

    const nameOrBrandChanged = existing.name !== name || existing.brandId !== brandId;

    const category = await prisma.productCategory.update({
      where: { id },
      data: {
        name,
        brandId,
        ...(nameOrBrandChanged ? { slug: await uniqueCategorySlug(brandId, slugify(name), id) } : {}),
        description: description ?? null,
        position,
        isActive,
      },
    });

    revalidatePath("/dashboard/boutique/categories");
    return { success: true, message: "Catégorie mise à jour.", data: category };
  } catch (error) {
    console.error("[updateProductCategory]", error);
    return { success: false, message: "Impossible de mettre à jour la catégorie." };
  }
}

/** Hard-blocked if it still has subcategories — no cascading surprises. */
export async function deleteProductCategory(id) {
  const guard = await requireAdmin();
  if (guard.error) return { success: false, message: guard.error };
  if (!id) return { success: false, message: "Identifiant manquant." };

  try {
    const category = await prisma.productCategory.findUnique({
      where: { id },
      include: { _count: { select: { subcategories: true } } },
    });
    if (!category) return { success: false, message: "Catégorie introuvable." };

    if (category._count.subcategories > 0) {
      return {
        success: false,
        message: `Impossible de supprimer : ${category._count.subcategories} sous-catégorie(s) en dépendent.`,
      };
    }

    await prisma.productCategory.delete({ where: { id } });
    revalidatePath("/dashboard/boutique/categories");
    return { success: true, message: "Catégorie supprimée." };
  } catch (error) {
    console.error("[deleteProductCategory]", error);
    return { success: false, message: "Impossible de supprimer la catégorie." };
  }
}

// ─── Subcategory CRUD ───────────────────────────────────────────────────────────

export async function createProductSubcategory(input) {
  const guard = await requireAdmin();
  if (guard.error) return { success: false, message: guard.error };

  const parsed = createProductSubcategorySchema.safeParse(input);
  if (!parsed.success) {
    const errors = parsed.error.flatten().fieldErrors;
    return {
      success: false,
      message: errors.name?.[0] ?? errors.categoryId?.[0] ?? "Données invalides.",
      errors: {
        name: errors.name?.[0] ?? null,
        categoryId: errors.categoryId?.[0] ?? null,
      },
    };
  }

  const { name, categoryId, position, isActive } = parsed.data;

  try {
    const category = await prisma.productCategory.findUnique({
      where: { id: categoryId },
      select: { id: true },
    });
    if (!category) {
      return {
        success: false,
        message: "Catégorie introuvable.",
        errors: { categoryId: "Catégorie introuvable." },
      };
    }

    const baseSlug = slugify(name);
    let slug = baseSlug;
    let n = 1;

    while (true) {
      const clash = await prisma.productSubcategory.findUnique({
        where: { categoryId_slug: { categoryId, slug } },
        select: { id: true },
      });
      if (!clash) break;
      n += 1;
      slug = `${baseSlug}-${n}`;
    }

    const subcategory = await prisma.productSubcategory.create({
      data: { name, categoryId, slug, position, isActive },
    });

    revalidatePath("/dashboard/boutique/categories");
    return { success: true, message: "Sous-catégorie créée.", data: subcategory };
  } catch (error) {
    console.error("[createProductSubcategory]", error);
    return { success: false, message: "Impossible de créer la sous-catégorie." };
  }
}

export async function updateProductSubcategory(input) {
  const guard = await requireAdmin();
  if (guard.error) return { success: false, message: guard.error };

  const parsed = updateProductSubcategorySchema.safeParse(input);
  if (!parsed.success) {
    const errors = parsed.error.flatten().fieldErrors;
    return {
      success: false,
      message: errors.name?.[0] ?? errors.categoryId?.[0] ?? "Données invalides.",
      errors: {
        name: errors.name?.[0] ?? null,
        categoryId: errors.categoryId?.[0] ?? null,
      },
    };
  }

  const { id, name, categoryId, position, isActive } = parsed.data;

  try {
    const existing = await prisma.productSubcategory.findUnique({ where: { id } });
    if (!existing) return { success: false, message: "Sous-catégorie introuvable." };

    const subcategory = await prisma.productSubcategory.update({
      where: { id },
      data: { name, categoryId, position, isActive },
    });

    revalidatePath("/dashboard/boutique/categories");
    return { success: true, message: "Sous-catégorie mise à jour.", data: subcategory };
  } catch (error) {
    console.error("[updateProductSubcategory]", error);
    return { success: false, message: "Impossible de mettre à jour la sous-catégorie." };
  }
}

export async function deleteProductSubcategory(id) {
  const guard = await requireAdmin();
  if (guard.error) return { success: false, message: guard.error };
  if (!id) return { success: false, message: "Identifiant manquant." };

  try {
    const subcategory = await prisma.productSubcategory.findUnique({
      where: { id },
      include: { _count: { select: { products: { where: { isDeleted: false } } } } },
    });
    if (!subcategory) return { success: false, message: "Sous-catégorie introuvable." };

    if (subcategory._count.products > 0) {
      return {
        success: false,
        message: `Impossible de supprimer : ${subcategory._count.products} produit(s) utilisent encore cette sous-catégorie. Supprimez-les (ou déplacez-les) d'abord.`,
      };
    }

    // Any already-archived (soft-deleted) product still referencing this
    // subcategory just loses the reference (Product.subcategoryId is nullable,
    // ON DELETE SET NULL) — its own row, and its OrderItem/invoice history, is
    // never touched.
    await prisma.productSubcategory.delete({ where: { id } });
    revalidatePath("/dashboard/boutique/categories");
    return { success: true, message: "Sous-catégorie supprimée." };
  } catch (error) {
    console.error("[deleteProductSubcategory]", error);
    return { success: false, message: "Impossible de supprimer la sous-catégorie." };
  }
}
