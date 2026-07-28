"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { isAdminRole, ROLES } from "@/lib/authorization";
import { stockAdjustmentSchema, stockCountSchema } from "@/lib/validations/boutique";

/**
 * Stock movements.
 *
 * Every change to ProductVariant.stockQuantity happens here, inside a
 * transaction that also writes the InventoryMovement row — the two must
 * never drift apart. SALE and RETURN belong to the order flow (Phase 2) and
 * are intentionally not exposed here; this module covers manual movements
 * only: RESTOCK, LOSS, ADJUSTMENT, SALON_USAGE.
 *
 * The DB-level CHECK constraints (stock >= 0, reserved <= stock) are the
 * backstop if this logic is ever bypassed — they are not the primary guard.
 */

async function requireStaff() {
  const session = await auth();
  if (!session?.user) return { error: "Non authentifié." };
  // Staff can log SALON_USAGE against their own service consumption;
  // RESTOCK/LOSS/ADJUSTMENT beyond that stay admin-only via the UI layer.
  const allowed = [ROLES.OWNER, ROLES.ADMIN, ROLES.STAFF];
  if (!allowed.includes(session.user.role)) return { error: "Accès non autorisé." };
  return { session };
}

/**
 * Applies a signed movement to a variant's stock. RESTOCK/RETURN increase
 * stock; SALE/LOSS/SALON_USAGE decrease it — direction is derived from
 * `type` so callers never pass a negative quantity by hand.
 */
export async function recordStockMovement(input) {
  const guard = await requireStaff();
  if (guard.error) return { success: false, message: guard.error };

  const parsed = stockAdjustmentSchema.safeParse(input);
  if (!parsed.success) {
    const errors = parsed.error.flatten().fieldErrors;
    return {
      success: false,
      message: errors.quantity?.[0] ?? errors.variantId?.[0] ?? "Données invalides.",
      errors,
    };
  }

  const { variantId, type, quantity, reason } = parsed.data;
  const increases = type === "RESTOCK";
  const signedQuantity = increases ? quantity : -quantity;

  try {
    const result = await prisma.$transaction(async (tx) => {
      // Row lock via a plain SELECT inside the transaction — Postgres holds
      // it until commit, which is what stops two concurrent adjustments
      // from both reading the same previousStock.
      const variant = await tx.productVariant.findUnique({
        where: { id: variantId, isDeleted: false },
        select: { id: true, stockQuantity: true, reservedQuantity: true, name: true, productId: true },
      });
      if (!variant) throw new Error("NOT_FOUND");

      const newStock = variant.stockQuantity + signedQuantity;
      if (newStock < 0) throw new Error("INSUFFICIENT_STOCK");
      if (newStock < variant.reservedQuantity) throw new Error("BELOW_RESERVED");

      const updated = await tx.productVariant.update({
        where: { id: variantId },
        data: { stockQuantity: newStock },
      });

      const movement = await tx.inventoryMovement.create({
        data: {
          variantId,
          type,
          quantity: signedQuantity,
          previousStock: variant.stockQuantity,
          newStock,
          reason: reason ?? null,
          createdById: guard.session.user.id,
        },
      });

      return { updated, movement };
    });

    revalidatePath("/dashboard/boutique/products");
    revalidatePath(`/dashboard/boutique/products/${result.updated.productId}`);
    revalidatePath("/dashboard/boutique/stock");

    return {
      success: true,
      message: "Mouvement de stock enregistré.",
      data: { stockQuantity: result.updated.stockQuantity, movementId: result.movement.id },
    };
  } catch (error) {
    if (error.message === "NOT_FOUND") {
      return { success: false, message: "Déclinaison introuvable." };
    }
    if (error.message === "INSUFFICIENT_STOCK") {
      return { success: false, message: "Stock insuffisant pour ce retrait." };
    }
    if (error.message === "BELOW_RESERVED") {
      return {
        success: false,
        message: "Ce retrait ferait passer le stock sous la quantité déjà réservée.",
      };
    }
    console.error("[recordStockMovement]", error);
    return { success: false, message: "Impossible d'enregistrer le mouvement." };
  }
}

/**
 * Sets stock to an absolute counted value (physical inventory count),
 * recorded as an ADJUSTMENT movement carrying the delta — so the ledger
 * still reads as "what changed," not "what the count was."
 */
export async function recordStockCount(input) {
  const guard = await requireStaff();
  if (guard.error) return { success: false, message: guard.error };

  const parsed = stockCountSchema.safeParse(input);
  if (!parsed.success) {
    const errors = parsed.error.flatten().fieldErrors;
    return {
      success: false,
      message: errors.countedQuantity?.[0] ?? errors.variantId?.[0] ?? "Données invalides.",
      errors,
    };
  }

  const { variantId, countedQuantity, reason } = parsed.data;

  try {
    const result = await prisma.$transaction(async (tx) => {
      const variant = await tx.productVariant.findUnique({
        where: { id: variantId, isDeleted: false },
        select: { id: true, stockQuantity: true, reservedQuantity: true, productId: true },
      });
      if (!variant) throw new Error("NOT_FOUND");

      const delta = countedQuantity - variant.stockQuantity;
      if (delta === 0) return { updated: variant, movement: null };

      if (countedQuantity < variant.reservedQuantity) throw new Error("BELOW_RESERVED");

      const updated = await tx.productVariant.update({
        where: { id: variantId },
        data: { stockQuantity: countedQuantity },
      });

      const movement = await tx.inventoryMovement.create({
        data: {
          variantId,
          type: "ADJUSTMENT",
          quantity: delta,
          previousStock: variant.stockQuantity,
          newStock: countedQuantity,
          reason: reason ?? "Comptage physique",
          createdById: guard.session.user.id,
        },
      });

      return { updated, movement };
    });

    revalidatePath("/dashboard/boutique/products");
    revalidatePath(`/dashboard/boutique/products/${result.updated.productId}`);
    revalidatePath("/dashboard/boutique/stock");

    return {
      success: true,
      message: result.movement ? "Stock ajusté." : "Aucun écart — stock inchangé.",
      data: { stockQuantity: result.updated.stockQuantity },
    };
  } catch (error) {
    if (error.message === "NOT_FOUND") {
      return { success: false, message: "Déclinaison introuvable." };
    }
    if (error.message === "BELOW_RESERVED") {
      return {
        success: false,
        message: "Le comptage est inférieur à la quantité déjà réservée par des commandes en cours.",
      };
    }
    console.error("[recordStockCount]", error);
    return { success: false, message: "Impossible d'ajuster le stock." };
  }
}

/** Variants at or below their low-stock threshold, for the dashboard alert. */
export async function getLowStockVariants() {
  try {
    const variants = await prisma.$queryRaw`
      SELECT v.id, v.name, v.sku, v."stockQuantity", v."reservedQuantity", v."lowStockThreshold",
             p.id as "productId", p.name as "productName"
      FROM "ProductVariant" v
      JOIN "Product" p ON p.id = v."productId"
      WHERE v."isDeleted" = false
        AND p."isDeleted" = false
        AND v."isActive" = true
        AND (v."stockQuantity" - v."reservedQuantity") <= v."lowStockThreshold"
      ORDER BY (v."stockQuantity" - v."reservedQuantity") ASC
      LIMIT 50
    `;

    return {
      success: true,
      data: variants.map((v) => ({
        ...v,
        availableQuantity: v.stockQuantity - v.reservedQuantity,
      })),
    };
  } catch (error) {
    console.error("[getLowStockVariants]", error);
    return { success: false, message: "Impossible de charger les alertes de stock.", data: [] };
  }
}

/** Movement history for one variant, most recent first. */
export async function getStockMovements(variantId, { take = 50 } = {}) {
  if (!variantId) return { success: false, message: "Identifiant manquant.", data: [] };

  try {
    const movements = await prisma.inventoryMovement.findMany({
      where: { variantId },
      orderBy: { createdAt: "desc" },
      take,
      include: { createdBy: { select: { fullName: true } } },
    });

    return { success: true, data: movements };
  } catch (error) {
    console.error("[getStockMovements]", error);
    return { success: false, message: "Impossible de charger l'historique.", data: [] };
  }
}
