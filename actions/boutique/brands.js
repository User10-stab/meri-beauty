"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { isAdminRole } from "@/lib/authorization";
import {
  createBrandSchema,
  updateBrandSchema,
  slugify,
} from "@/lib/validations/boutique";

/**
 * Brand management.
 *
 * Brands deliberately carry no category link — a beauty brand spans several
 * categories, and a stored link could only ever disagree with the products
 * themselves. Use getBrandCategories() to derive it from actual products.
 */

async function requireAdmin() {
  const session = await auth();
  if (!session?.user) return { error: "Non authentifié." };
  if (!isAdminRole(session.user.role)) return { error: "Accès non autorisé." };
  return { session };
}

/** Finds a free slug, appending -2, -3 … when the base is taken. */
async function uniqueBrandSlug(base, excludeId = null) {
  let slug = base;
  let n = 1;
   
  while (true) {
    const clash = await prisma.brand.findUnique({
      where: { slug },
      select: { id: true },
    });
    if (!clash || clash.id === excludeId) return slug;
    n += 1;
    slug = `${base}-${n}`;
  }
}

export async function getBrands({ includeInactive = false } = {}) {
  try {
    const brands = await prisma.brand.findMany({
      where: {
        isDeleted: false,
        ...(includeInactive ? {} : { isActive: true }),
      },
      orderBy: { name: "asc" },
      include: { _count: { select: { products: true } } },
    });

    return {
      success: true,
      data: brands.map((b) => ({
        id: b.id,
        name: b.name,
        slug: b.slug,
        logo: b.logo,
        description: b.description,
        isActive: b.isActive,
        productCount: b._count.products,
      })),
    };
  } catch (error) {
    console.error("[getBrands]", error);
    return { success: false, message: "Impossible de charger les marques.", data: [] };
  }
}

/**
 * Derives which categories a brand actually sells into, from its products.
 * This is the replacement for a stored Brand→Category link.
 */
export async function getBrandCategories(brandId) {
  try {
    const products = await prisma.product.findMany({
      where: { brandId, isDeleted: false, status: "ACTIVE" },
      select: {
        subcategory: {
          select: { id: true, name: true, category: { select: { id: true, name: true, slug: true } } },
        },
      },
    });

    const categories = new Map();
    for (const p of products) {
      const c = p.subcategory.category;
      if (!categories.has(c.id)) categories.set(c.id, { ...c, subcategories: new Map() });
      categories
        .get(c.id)
        .subcategories.set(p.subcategory.id, { id: p.subcategory.id, name: p.subcategory.name });
    }

    return {
      success: true,
      data: [...categories.values()].map((c) => ({
        id: c.id,
        name: c.name,
        slug: c.slug,
        subcategories: [...c.subcategories.values()],
      })),
    };
  } catch (error) {
    console.error("[getBrandCategories]", error);
    return { success: false, message: "Impossible de charger les catégories.", data: [] };
  }
}

export async function createBrand(input) {
  const guard = await requireAdmin();
  if (guard.error) return { success: false, message: guard.error };

  const parsed = createBrandSchema.safeParse(input);
  if (!parsed.success) {
    const errors = parsed.error.flatten().fieldErrors;
    return {
      success: false,
      message: errors.name?.[0] ?? "Données invalides.",
      errors: { name: errors.name?.[0] ?? null },
    };
  }

  const { name, description, logo, isActive } = parsed.data;

  try {
    const duplicate = await prisma.brand.findFirst({
      where: { name: { equals: name, mode: "insensitive" }, isDeleted: false },
      select: { id: true },
    });
    if (duplicate) {
      return {
        success: false,
        message: "Une marque portant ce nom existe déjà.",
        errors: { name: "Ce nom est déjà utilisé." },
      };
    }

    const brand = await prisma.brand.create({
      data: {
        name,
        slug: await uniqueBrandSlug(slugify(name)),
        description: description ?? null,
        logo: logo ?? null,
        isActive,
      },
    });

    revalidatePath("/dashboard/boutique/brands");
    return { success: true, message: "Marque créée.", data: brand };
  } catch (error) {
    console.error("[createBrand]", error);
    return { success: false, message: "Impossible de créer la marque." };
  }
}

export async function updateBrand(input) {
  const guard = await requireAdmin();
  if (guard.error) return { success: false, message: guard.error };

  const parsed = updateBrandSchema.safeParse(input);
  if (!parsed.success) {
    const errors = parsed.error.flatten().fieldErrors;
    return {
      success: false,
      message: errors.name?.[0] ?? "Données invalides.",
      errors: { name: errors.name?.[0] ?? null },
    };
  }

  const { id, name, description, logo, isActive } = parsed.data;

  try {
    const existing = await prisma.brand.findUnique({ where: { id }, select: { id: true, name: true } });
    if (!existing) {
      return { success: false, message: "Marque introuvable." };
    }

    const duplicate = await prisma.brand.findFirst({
      where: { name: { equals: name, mode: "insensitive" }, isDeleted: false, id: { not: id } },
      select: { id: true },
    });
    if (duplicate) {
      return {
        success: false,
        message: "Une marque portant ce nom existe déjà.",
        errors: { name: "Ce nom est déjà utilisé." },
      };
    }

    const brand = await prisma.brand.update({
      where: { id },
      data: {
        name,
        // Only re-slug when the name actually changed, so existing links survive.
        ...(existing.name !== name ? { slug: await uniqueBrandSlug(slugify(name), id) } : {}),
        description: description ?? null,
        logo: logo ?? null,
        isActive,
      },
    });

    revalidatePath("/dashboard/boutique/brands");
    return { success: true, message: "Marque mise à jour.", data: brand };
  } catch (error) {
    console.error("[updateBrand]", error);
    return { success: false, message: "Impossible de mettre à jour la marque." };
  }
}

/**
 * Soft delete. Products keep their brandId, so historical orders and product
 * pages stay intact; the brand simply stops appearing in listings.
 */
export async function deleteBrand(id) {
  const guard = await requireAdmin();
  if (guard.error) return { success: false, message: guard.error };

  if (!id) return { success: false, message: "Identifiant manquant." };

  try {
    const brand = await prisma.brand.findUnique({
      where: { id },
      include: { _count: { select: { products: true } } },
    });
    if (!brand) return { success: false, message: "Marque introuvable." };

    await prisma.brand.update({
      where: { id },
      data: { isDeleted: true, deletedAt: new Date(), isActive: false },
    });

    revalidatePath("/dashboard/boutique/brands");
    return {
      success: true,
      message: brand._count.products
        ? `Marque supprimée. ${brand._count.products} produit(s) conservent leur référence.`
        : "Marque supprimée.",
    };
  } catch (error) {
    console.error("[deleteBrand]", error);
    return { success: false, message: "Impossible de supprimer la marque." };
  }
}
