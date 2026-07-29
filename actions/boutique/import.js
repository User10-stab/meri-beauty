"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { isAdminRole } from "@/lib/authorization";
import { slugify } from "@/lib/validations/boutique";
import {
  parseWixProductsCsv,
  parseWixInventoryCsv,
  summarizeSlugs,
  resolveProductClassification,
} from "@/lib/wixImport";

/**
 * One-off Wix catalogue migration. Two steps, deliberately not one click:
 * Wix's export has no brand/category distinction and no 2-level
 * category→subcategory split (just a flat tag list per product), so a slug
 * like "purple" or "staleks" could be either a brand or a genuine category —
 * previewWixImport() never guesses that, it only surfaces a data-derived
 * hint for the admin to confirm or override before runWixImport() writes
 * anything.
 */

async function requireAdmin() {
  const session = await auth();
  if (!session?.user) return { error: "Non authentifié." };
  if (!isAdminRole(session.user.role)) return { error: "Accès non autorisé." };
  return { session };
}

async function uniqueSlug(model, base, extraWhere = {}) {
  let slug = base;
  let n = 1;
  while (true) {
    const clash = await prisma[model].findFirst({ where: { slug, ...extraWhere }, select: { id: true } });
    if (!clash) return slug;
    n += 1;
    slug = `${base}-${n}`;
  }
}

async function uniqueSku(base) {
  let sku = base;
  let n = 1;
  while (true) {
    const clash = await prisma.productVariant.findUnique({ where: { sku }, select: { id: true } });
    if (!clash) return sku;
    n += 1;
    sku = `${base}-${n}`;
  }
}

export async function previewWixImport({ productsCsv, inventoryCsv }) {
  const guard = await requireAdmin();
  if (guard.error) return { success: false, message: guard.error };

  if (!productsCsv?.trim()) return { success: false, message: "Fichier produits manquant." };

  let products;
  try {
    products = parseWixProductsCsv(productsCsv);
  } catch (error) {
    console.error("[previewWixImport] parse failed:", error);
    return { success: false, message: "Le fichier produits n'a pas pu être lu — vérifiez qu'il s'agit bien d'un export Wix." };
  }
  if (!products.length) return { success: false, message: "Aucun produit trouvé dans ce fichier." };

  const stockByHandle = inventoryCsv?.trim() ? parseWixInventoryCsv(inventoryCsv) : new Map();
  const withStock = products.map((p) => ({
    ...p,
    stockQuantity: stockByHandle.get(p.handle) ?? 0,
    stockIsExact: stockByHandle.has(p.handle),
  }));

  return {
    success: true,
    data: { products: withStock, slugs: summarizeSlugs(withStock) },
  };
}

export async function runWixImport({ products, slugMapping, parentCategoryName }) {
  const guard = await requireAdmin();
  if (guard.error) return { success: false, message: guard.error };
  if (!products?.length) return { success: false, message: "Aucun produit à importer." };
  if (!parentCategoryName?.trim()) return { success: false, message: "Choisissez une catégorie parente pour les sous-catégories." };

  const brandCache = new Map();
  const subcategoryCache = new Map();
  let parentCategoryId = null;

  try {
    let category = await prisma.productCategory.findFirst({
      where: { name: { equals: parentCategoryName.trim(), mode: "insensitive" } },
    });
    if (!category) {
      category = await prisma.productCategory.create({
        data: { name: parentCategoryName.trim(), slug: await uniqueSlug("productCategory", slugify(parentCategoryName)) },
      });
    }
    parentCategoryId = category.id;
  } catch (error) {
    console.error("[runWixImport] parent category setup failed:", error);
    return { success: false, message: "Impossible de créer/trouver la catégorie parente." };
  }

  const createdIds = [];
  const errors = [];

  for (const p of products) {
    try {
      const { brandName, subcategoryName } = resolveProductClassification(p, slugMapping);

      let brandId = null;
      if (brandName) {
        const key = brandName.toLowerCase();
        if (!brandCache.has(key)) {
          let brand = await prisma.brand.findFirst({ where: { name: { equals: brandName, mode: "insensitive" } } });
          if (!brand) {
            brand = await prisma.brand.create({ data: { name: brandName, slug: await uniqueSlug("brand", slugify(brandName)) } });
          }
          brandCache.set(key, brand.id);
        }
        brandId = brandCache.get(key);
      }

      const subName = subcategoryName || "Non classé";
      const subKey = subName.toLowerCase();
      if (!subcategoryCache.has(subKey)) {
        let sub = await prisma.productSubcategory.findFirst({
          where: { categoryId: parentCategoryId, name: { equals: subName, mode: "insensitive" } },
        });
        if (!sub) {
          sub = await prisma.productSubcategory.create({
            data: {
              name: subName,
              slug: await uniqueSlug("productSubcategory", slugify(subName), { categoryId: parentCategoryId }),
              categoryId: parentCategoryId,
            },
          });
        }
        subcategoryCache.set(subKey, sub.id);
      }
      const subcategoryId = subcategoryCache.get(subKey);

      const sku = await uniqueSku(`WIX-${slugify(p.name).toUpperCase().slice(0, 16)}`);

      const product = await prisma.product.create({
        data: {
          name: p.name,
          slug: await uniqueSlug("product", slugify(p.name)),
          description: p.description || null,
          brandId,
          subcategoryId,
          status: "DRAFT", // reviewed by staff before going live on the storefront
          variants: {
            create: [
              {
                name: "Standard",
                sku,
                price: p.price,
                costPrice: p.costPrice,
                comparePrice: p.comparePrice,
                stockQuantity: p.stockQuantity,
                isActive: true,
              },
            ],
          },
          images: { create: p.images.map((path, i) => ({ path, position: i, isPrimary: i === 0 })) },
        },
        include: { variants: true },
      });

      if (p.stockQuantity > 0) {
        await prisma.inventoryMovement.create({
          data: {
            variantId: product.variants[0].id,
            type: "RESTOCK",
            quantity: p.stockQuantity,
            previousStock: 0,
            newStock: p.stockQuantity,
            reason: "Import Wix",
            createdById: guard.session.user.id,
          },
        });
      }

      createdIds.push(product.id);
    } catch (error) {
      console.error("[runWixImport] failed for product:", p.name, error);
      errors.push({ name: p.name, message: error.message });
    }
  }

  revalidatePath("/dashboard/boutique/products");
  return {
    success: true,
    message: `${createdIds.length} produit(s) importé(s) en brouillon${errors.length ? `, ${errors.length} échec(s)` : ""}.`,
    data: { createdCount: createdIds.length, errors },
  };
}
