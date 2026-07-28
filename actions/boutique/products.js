"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { isAdminRole } from "@/lib/authorization";
import {
  createProductSchema,
  updateProductSchema,
  slugify,
} from "@/lib/validations/boutique";

/**
 * Product + variant management.
 *
 * A product is descriptive only (name, brand, category, images). Every price,
 * stock level and SKU lives on ProductVariant — a single-size product still
 * has exactly one variant, named "Standard" unless given otherwise.
 *
 * profit/margin are computed here on read, never stored — see
 * lib/validations/boutique.js for why.
 */

async function requireAdmin() {
  const session = await auth();
  if (!session?.user) return { error: "Non authentifié." };
  if (!isAdminRole(session.user.role)) return { error: "Accès non autorisé." };
  return { session };
}

async function uniqueProductSlug(base, excludeId = null) {
  let slug = base;
  let n = 1;
   
  while (true) {
    const clash = await prisma.product.findUnique({ where: { slug }, select: { id: true } });
    if (!clash || clash.id === excludeId) return slug;
    n += 1;
    slug = `${base}-${n}`;
  }
}

/** Attaches computed profit/margin to a variant without storing them. */
function withMargin(variant) {
  const price = Number(variant.price);
  const cost = Number(variant.costPrice);
  const profit = price - cost;
  return {
    ...variant,
    price,
    costPrice: cost,
    comparePrice: variant.comparePrice != null ? Number(variant.comparePrice) : null,
    profit,
    marginPercent: price > 0 ? Number(((profit / price) * 100).toFixed(1)) : 0,
    availableQuantity: variant.stockQuantity - variant.reservedQuantity,
  };
}

// ─── Read ─────────────────────────────────────────────────────────────────────

export async function getProducts({
  search,
  categoryId,
  subcategoryId,
  brandId,
  status,
  includeDeleted = false,
  page = 1,
  pageSize = 20,
} = {}) {
  try {
    const where = {
      isDeleted: includeDeleted ? undefined : false,
      ...(status ? { status } : {}),
      ...(brandId ? { brandId } : {}),
      ...(subcategoryId
        ? { subcategoryId }
        : categoryId
        ? { subcategory: { categoryId } }
        : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: "insensitive" } },
              { variants: { some: { sku: { contains: search, mode: "insensitive" } } } },
              { variants: { some: { barcode: { contains: search, mode: "insensitive" } } } },
            ],
          }
        : {}),
    };

    const [products, total] = await Promise.all([
      prisma.product.findMany({
        where,
        orderBy: { updatedAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          brand: { select: { id: true, name: true } },
          subcategory: { select: { id: true, name: true, category: { select: { id: true, name: true } } } },
          variants: { where: { isDeleted: false }, orderBy: { position: "asc" } },
          images: { orderBy: { position: "asc" }, take: 1 },
        },
      }),
      prisma.product.count({ where }),
    ]);

    return {
      success: true,
      data: products.map((p) => ({
        id: p.id,
        name: p.name,
        slug: p.slug,
        status: p.status,
        brand: p.brand,
        category: p.subcategory.category,
        subcategory: { id: p.subcategory.id, name: p.subcategory.name },
        thumbnail: p.images[0]?.path ?? null,
        variants: p.variants.map(withMargin),
        totalStock: p.variants.reduce((sum, v) => sum + v.stockQuantity, 0),
        lowStock: p.variants.some((v) => v.stockQuantity - v.reservedQuantity <= v.lowStockThreshold),
      })),
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    };
  } catch (error) {
    console.error("[getProducts]", error);
    return { success: false, message: "Impossible de charger les produits.", data: [] };
  }
}

export async function getProductById(id) {
  try {
    const product = await prisma.product.findUnique({
      where: { id, isDeleted: false },
      include: {
        brand: { select: { id: true, name: true } },
        subcategory: { select: { id: true, name: true, categoryId: true } },
        variants: { where: { isDeleted: false }, orderBy: { position: "asc" } },
        images: { orderBy: { position: "asc" } },
      },
    });

    if (!product) return { success: false, message: "Produit introuvable." };

    return {
      success: true,
      data: { ...product, variants: product.variants.map(withMargin) },
    };
  } catch (error) {
    console.error("[getProductById]", error);
    return { success: false, message: "Impossible de charger le produit." };
  }
}

// ─── Create ───────────────────────────────────────────────────────────────────

export async function createProduct(input) {
  const guard = await requireAdmin();
  if (guard.error) return { success: false, message: guard.error };

  const parsed = createProductSchema.safeParse(input);
  if (!parsed.success) {
    const errors = parsed.error.flatten().fieldErrors;
    return {
      success: false,
      message: errors.name?.[0] ?? errors.subcategoryId?.[0] ?? "Données invalides.",
      errors,
    };
  }

  const { name, description, brandId, subcategoryId, status, variants, images } = parsed.data;

  try {
    const subcategory = await prisma.productSubcategory.findUnique({
      where: { id: subcategoryId },
      select: { id: true },
    });
    if (!subcategory) {
      return {
        success: false,
        message: "Sous-catégorie introuvable.",
        errors: { subcategoryId: "Sous-catégorie introuvable." },
      };
    }

    // SKU/barcode collisions fail loudly and early — the alternative is a
    // half-created product blocked by a unique constraint mid-transaction.
    const skuClash = await findVariantClash(variants);
    if (skuClash) return skuClash;

    const product = await prisma.product.create({
      data: {
        name,
        slug: await uniqueProductSlug(slugify(name)),
        description: description ?? null,
        brandId,
        subcategoryId,
        status,
        variants: {
          create: variants.map((v, i) => ({
            name: v.name || "Standard",
            sku: v.sku,
            barcode: v.barcode,
            price: v.price,
            costPrice: v.costPrice,
            comparePrice: v.comparePrice ?? null,
            stockQuantity: v.stockQuantity,
            lowStockThreshold: v.lowStockThreshold,
            position: v.position ?? i,
            isActive: v.isActive,
          })),
        },
        images: {
          create: images.map((img, i) => ({
            path: img.path,
            alt: img.alt ?? null,
            position: img.position ?? i,
            isPrimary: img.isPrimary ?? i === 0,
          })),
        },
      },
      include: { variants: true, images: true },
    });

    // Opening stock is a real movement, not a silent default — the ledger
    // should reconcile from day one.
    if (variants.some((v) => v.stockQuantity > 0)) {
      await prisma.$transaction(
        product.variants
          .filter((v) => v.stockQuantity > 0)
          .map((v) =>
            prisma.inventoryMovement.create({
              data: {
                variantId: v.id,
                type: "RESTOCK",
                quantity: v.stockQuantity,
                previousStock: 0,
                newStock: v.stockQuantity,
                reason: "Stock initial",
                createdById: guard.session.user.id,
              },
            })
          )
      );
    }

    revalidatePath("/dashboard/boutique/products");
    return { success: true, message: "Produit créé.", data: product };
  } catch (error) {
    console.error("[createProduct]", error);
    return { success: false, message: "Impossible de créer le produit." };
  }
}

// ─── Update ───────────────────────────────────────────────────────────────────

/**
 * Reconciles the submitted variant list against what exists: variants with an
 * id are updated, variants without one are created, and existing variants
 * missing from the submission are soft-deleted (never hard-deleted — an
 * OrderItem may reference them forever).
 */
export async function updateProduct(input) {
  const guard = await requireAdmin();
  if (guard.error) return { success: false, message: guard.error };

  const parsed = updateProductSchema.safeParse(input);
  if (!parsed.success) {
    const errors = parsed.error.flatten().fieldErrors;
    return {
      success: false,
      message: errors.name?.[0] ?? errors.subcategoryId?.[0] ?? "Données invalides.",
      errors,
    };
  }

  const { id, name, description, brandId, subcategoryId, status, variants, images } = parsed.data;

  try {
    const existing = await prisma.product.findUnique({
      where: { id, isDeleted: false },
      include: { variants: { where: { isDeleted: false } } },
    });
    if (!existing) return { success: false, message: "Produit introuvable." };

    const skuClash = await findVariantClash(variants, id);
    if (skuClash) return skuClash;

    const submittedIds = new Set(variants.filter((v) => v.id).map((v) => v.id));
    const toRemove = existing.variants.filter((v) => !submittedIds.has(v.id));

    await prisma.$transaction(async (tx) => {
      await tx.product.update({
        where: { id },
        data: {
          name,
          ...(existing.name !== name ? { slug: await uniqueProductSlug(slugify(name), id) } : {}),
          description: description ?? null,
          brandId,
          subcategoryId,
          status,
        },
      });

      for (const v of variants) {
        if (v.id) {
          await tx.productVariant.update({
            where: { id: v.id },
            data: {
              name: v.name || "Standard",
              sku: v.sku,
              barcode: v.barcode,
              price: v.price,
              costPrice: v.costPrice,
              comparePrice: v.comparePrice ?? null,
              lowStockThreshold: v.lowStockThreshold,
              position: v.position ?? 0,
              isActive: v.isActive,
              // stockQuantity is deliberately NOT updated here — it only
              // changes through recordStockMovement, so the ledger always
              // reconciles.
            },
          });
        } else {
          const created = await tx.productVariant.create({
            data: {
              productId: id,
              name: v.name || "Standard",
              sku: v.sku,
              barcode: v.barcode,
              price: v.price,
              costPrice: v.costPrice,
              comparePrice: v.comparePrice ?? null,
              stockQuantity: v.stockQuantity,
              lowStockThreshold: v.lowStockThreshold,
              position: v.position ?? 0,
              isActive: v.isActive,
            },
          });
          if (v.stockQuantity > 0) {
            await tx.inventoryMovement.create({
              data: {
                variantId: created.id,
                type: "RESTOCK",
                quantity: v.stockQuantity,
                previousStock: 0,
                newStock: v.stockQuantity,
                reason: "Nouvelle déclinaison",
                createdById: guard.session.user.id,
              },
            });
          }
        }
      }

      for (const v of toRemove) {
        await tx.productVariant.update({
          where: { id: v.id },
          data: { isDeleted: true, deletedAt: new Date(), isActive: false },
        });
      }

      if (images.length) {
        await tx.productImage.deleteMany({ where: { productId: id } });
        await tx.productImage.createMany({
          data: images.map((img, i) => ({
            productId: id,
            path: img.path,
            alt: img.alt ?? null,
            position: img.position ?? i,
            isPrimary: img.isPrimary ?? i === 0,
          })),
        });
      }
    });

    revalidatePath("/dashboard/boutique/products");
    revalidatePath(`/dashboard/boutique/products/${id}`);
    return { success: true, message: "Produit mis à jour." };
  } catch (error) {
    console.error("[updateProduct]", error);
    return { success: false, message: "Impossible de mettre à jour le produit." };
  }
}

/**
 * Never hard-deleted — an OrderItem snapshot references the variant row
 * forever. Soft delete removes it from every listing and search.
 */
export async function deleteProduct(id) {
  const guard = await requireAdmin();
  if (guard.error) return { success: false, message: guard.error };
  if (!id) return { success: false, message: "Identifiant manquant." };

  try {
    const product = await prisma.product.findUnique({ where: { id }, select: { id: true } });
    if (!product) return { success: false, message: "Produit introuvable." };

    await prisma.$transaction([
      prisma.product.update({
        where: { id },
        data: { isDeleted: true, deletedAt: new Date(), status: "ARCHIVED" },
      }),
      prisma.productVariant.updateMany({
        where: { productId: id },
        data: { isDeleted: true, deletedAt: new Date(), isActive: false },
      }),
    ]);

    revalidatePath("/dashboard/boutique/products");
    return { success: true, message: "Produit supprimé." };
  } catch (error) {
    console.error("[deleteProduct]", error);
    return { success: false, message: "Impossible de supprimer le produit." };
  }
}

// ─── Shared ───────────────────────────────────────────────────────────────────

/**
 * Checks submitted SKUs/barcodes against the database before writing, so a
 * collision fails as one clean validation error instead of a partially
 * applied transaction hitting a unique constraint.
 */
async function findVariantClash(variants, excludeProductId = null) {
  const skus = variants.map((v) => v.sku);
  const barcodes = variants.map((v) => v.barcode).filter(Boolean);

  const dupSkusInPayload = skus.filter((s, i) => skus.indexOf(s) !== i);
  if (dupSkusInPayload.length) {
    return {
      success: false,
      message: `Référence en double dans le formulaire : ${dupSkusInPayload[0]}`,
    };
  }

  const [skuClash, barcodeClash] = await Promise.all([
    prisma.productVariant.findFirst({
      where: {
        sku: { in: skus },
        isDeleted: false,
        ...(excludeProductId ? { productId: { not: excludeProductId } } : {}),
      },
      select: { sku: true },
    }),
    barcodes.length
      ? prisma.productVariant.findFirst({
          where: {
            barcode: { in: barcodes },
            isDeleted: false,
            ...(excludeProductId ? { productId: { not: excludeProductId } } : {}),
          },
          select: { barcode: true },
        })
      : null,
  ]);

  if (skuClash) {
    return { success: false, message: `La référence "${skuClash.sku}" est déjà utilisée.` };
  }
  if (barcodeClash) {
    return { success: false, message: `Le code-barres "${barcodeClash.barcode}" est déjà utilisé.` };
  }
  return null;
}
