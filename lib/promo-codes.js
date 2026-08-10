import { prisma } from "@/lib/prisma";

/**
 * Computes the discount a code grants against a given subtotal, without
 * touching the DB — shared by validatePromoCode's live preview and every
 * create action's server-side re-validation, so the two can never diverge.
 */
function computeDiscount(promo, subtotal) {
  const raw = promo.type === "PERCENTAGE" ? (subtotal * Number(promo.value)) / 100 : Number(promo.value);
  return Math.min(raw, subtotal); // never discount below zero
}

/**
 * Looks up a code and validates it against a subtotal — used both for the
 * client-side live preview (`validatePromoCode` in actions/promo-codes.js)
 * and internally by every create action right before charging, so a client
 * can never hand over a pre-computed discount and have it trusted.
 *
 * Deliberately kept out of any "use server" module — every export from a
 * "use server" file is a public, unauthenticated POST endpoint. This one is
 * meant to be called only from other server-side code (never directly by a
 * client), unlike validatePromoCode which is the intentionally-public,
 * stripped-down preview version.
 */
export async function resolvePromoCode(rawCode, subtotal) {
  const code = rawCode?.trim().toUpperCase();
  if (!code) return { success: false, message: "Veuillez entrer un code." };

  const promo = await prisma.promoCode.findUnique({ where: { code } });
  if (!promo || !promo.isActive) {
    return { success: false, message: "Ce code promo n'existe pas ou n'est plus valide." };
  }
  if (promo.minOrderAmount != null && subtotal < Number(promo.minOrderAmount)) {
    return {
      success: false,
      message: `Ce code nécessite un montant minimum de ${Number(promo.minOrderAmount).toFixed(2)} €.`,
    };
  }

  return { success: true, promoCodeId: promo.id, discountAmount: computeDiscount(promo, subtotal) };
}
