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
 * Brand management. Brand is the root of the catalogue tree
 * (Brand → ProductCategory → ProductSubcategory → Product, client decision
 * 29 Jul 2026) — there's no longer a standalone "Marques" dashboard page;
 * brand CRUD is folded into the Catégories tree view.
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
      include: { _count: { select: { categories: true } } },
    });

    return {
      success: true,
      data: await Promise.all(
        brands.map(async (b) => ({
          id: b.id,
          name: b.name,
          slug: b.slug,
          logo: b.logo,
          description: b.description,
          isActive: b.isActive,
          categoryCount: b._count.categories,
          productCount: await prisma.product.count({ where: { subcategory: { category: { brandId: b.id } } } }),
        }))
      ),
    };
  } catch (error) {
    console.error("[getBrands]", error);
    return { success: false, message: "Impossible de charger les marques.", data: [] };
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

    revalidatePath("/dashboard/boutique/categories");
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

    revalidatePath("/dashboard/boutique/categories");
    return { success: true, message: "Marque mise à jour.", data: brand };
  } catch (error) {
    console.error("[updateBrand]", error);
    return { success: false, message: "Impossible de mettre à jour la marque." };
  }
}

/**
 * Soft delete (deactivate) — matches deleteProductCategory()'s pattern: a
 * brand can't be removed while it still has categories underneath, so the
 * tree has to be pruned bottom-up (products, then subcategories, then
 * categories) before the brand itself becomes deletable. This is what
 * actually makes "cannot delete a brand while a subcategory still has a
 * product" true — it's enforced transitively, one level at a time.
 */
export async function deleteBrand(id) {
  const guard = await requireAdmin();
  if (guard.error) return { success: false, message: guard.error };

  if (!id) return { success: false, message: "Identifiant manquant." };

  try {
    const brand = await prisma.brand.findUnique({
      where: { id },
      include: { _count: { select: { categories: true } } },
    });
    if (!brand) return { success: false, message: "Marque introuvable." };

    if (brand._count.categories > 0) {
      return {
        success: false,
        message: `Impossible de supprimer : ${brand._count.categories} catégorie(s) en dépendent. Supprimez-les d'abord (chacune requiert que ses sous-catégories soient vides de produits).`,
      };
    }

    await prisma.brand.update({
      where: { id },
      data: { isDeleted: true, deletedAt: new Date(), isActive: false },
    });

    revalidatePath("/dashboard/boutique/categories");
    return { success: true, message: "Marque supprimée." };
  } catch (error) {
    console.error("[deleteBrand]", error);
    return { success: false, message: "Impossible de supprimer la marque." };
  }
}
