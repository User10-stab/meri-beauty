"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { isAdminRole } from "@/lib/authorization";
import { promoCodeSchema, updatePromoCodeSchema } from "@/lib/validations/promo-codes";
import { resolvePromoCode } from "@/lib/promo-codes";

/**
 * Promo codes apply across all four purchase flows (boutique, ateliers,
 * formations, appointments) — not a boutique-only concept — so this lives
 * at the top level of actions/, not under actions/boutique/.
 */

async function requireAdmin() {
  const session = await auth();
  if (!session?.user) return { error: "Non authentifié." };
  if (!isAdminRole(session.user.role)) return { error: "Accès non autorisé." };
  return { session };
}

function serializePromoCode(p) {
  return {
    id: p.id,
    code: p.code,
    type: p.type,
    value: Number(p.value),
    minOrderAmount: p.minOrderAmount != null ? Number(p.minOrderAmount) : null,
    isActive: p.isActive,
    createdAt: p.createdAt,
  };
}

/** Public — called from the 4 checkout UIs for a live discount preview. */
export async function validatePromoCode(rawCode, subtotal) {
  try {
    const result = await resolvePromoCode(rawCode, Number(subtotal) || 0);
    if (!result.success) return result;
    return { success: true, discountAmount: result.discountAmount };
  } catch (error) {
    console.error("[validatePromoCode]", error);
    return { success: false, message: "Impossible de vérifier ce code pour le moment." };
  }
}

export async function listPromoCodes() {
  const guard = await requireAdmin();
  if (guard.error) return { success: false, message: guard.error, data: [] };

  try {
    const codes = await prisma.promoCode.findMany({ orderBy: { createdAt: "desc" } });
    return { success: true, data: codes.map(serializePromoCode) };
  } catch (error) {
    console.error("[listPromoCodes]", error);
    return { success: false, message: "Impossible de charger les codes promo.", data: [] };
  }
}

export async function createPromoCode(input) {
  const guard = await requireAdmin();
  if (guard.error) return { success: false, message: guard.error };

  const parsed = promoCodeSchema.safeParse(input);
  if (!parsed.success) {
    const errors = parsed.error.flatten().fieldErrors;
    return {
      success: false,
      message: Object.values(errors)[0]?.[0] ?? "Données invalides.",
      errors,
    };
  }

  const { code, type, value, minOrderAmount, isActive } = parsed.data;

  try {
    const duplicate = await prisma.promoCode.findUnique({ where: { code }, select: { id: true } });
    if (duplicate) {
      return { success: false, message: "Ce code existe déjà.", errors: { code: ["Ce code existe déjà."] } };
    }

    const promo = await prisma.promoCode.create({
      data: { code, type, value, minOrderAmount: minOrderAmount ?? null, isActive },
    });

    revalidatePath("/dashboard/promo-codes");
    return { success: true, message: "Code promo créé.", data: serializePromoCode(promo) };
  } catch (error) {
    console.error("[createPromoCode]", error);
    return { success: false, message: "Impossible de créer le code promo." };
  }
}

export async function updatePromoCode(input) {
  const guard = await requireAdmin();
  if (guard.error) return { success: false, message: guard.error };

  const parsed = updatePromoCodeSchema.safeParse(input);
  if (!parsed.success) {
    const errors = parsed.error.flatten().fieldErrors;
    return {
      success: false,
      message: Object.values(errors)[0]?.[0] ?? "Données invalides.",
      errors,
    };
  }

  const { id, code, type, value, minOrderAmount, isActive } = parsed.data;

  try {
    const existing = await prisma.promoCode.findUnique({ where: { id }, select: { id: true } });
    if (!existing) return { success: false, message: "Code promo introuvable." };

    const duplicate = await prisma.promoCode.findFirst({ where: { code, id: { not: id } }, select: { id: true } });
    if (duplicate) {
      return { success: false, message: "Ce code existe déjà.", errors: { code: ["Ce code existe déjà."] } };
    }

    const promo = await prisma.promoCode.update({
      where: { id },
      data: { code, type, value, minOrderAmount: minOrderAmount ?? null, isActive },
    });

    revalidatePath("/dashboard/promo-codes");
    return { success: true, message: "Code promo mis à jour.", data: serializePromoCode(promo) };
  } catch (error) {
    console.error("[updatePromoCode]", error);
    return { success: false, message: "Impossible de mettre à jour le code promo." };
  }
}

/**
 * Never a hard delete — codes stay in the DB (past `Payment` rows reference
 * them) and are just switched off, matching the client's "manual
 * deactivation only" requirement.
 */
export async function deletePromoCode(id) {
  const guard = await requireAdmin();
  if (guard.error) return { success: false, message: guard.error };
  if (!id) return { success: false, message: "Identifiant manquant." };

  try {
    const existing = await prisma.promoCode.findUnique({ where: { id } });
    if (!existing) return { success: false, message: "Code promo introuvable." };

    await prisma.promoCode.update({ where: { id }, data: { isActive: false } });

    revalidatePath("/dashboard/promo-codes");
    return { success: true, message: "Code promo désactivé." };
  } catch (error) {
    console.error("[deletePromoCode]", error);
    return { success: false, message: "Impossible de désactiver le code promo." };
  }
}
