"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canAccessDashboard } from "@/lib/authorization";
import { resolvePromoCode } from "@/lib/promo-codes";
import { PROMO_CODE_SCOPES } from "@/lib/promo-code-scopes";

/**
 * The till's live promo preview — the counter's own version of the public
 * validatePromoCode (actions/promo-codes.js). Staff only, so it is not
 * IP-rate-limited like the public one (the whole salon shares one IP), and
 * it can check the client-bound rules against the client picked at the till.
 *
 * Only a preview: every till sale re-validates and claims the code inside
 * its own transaction (applyCounterPromoCode), so nothing here is trusted.
 *
 * `context`:
 *  - scope: "BOUTIQUE" | "APPOINTMENT" | "WORKSHOP" | "FORMATION"
 *  - items: BOUTIQUE only — [{ variantId, quantity }]; priced here at shelf
 *    price, so the cart never has to know which product a variant belongs to.
 *  - staffServiceId: APPOINTMENT only
 *  - customerId: the client selected at the till, if any
 */
export async function previewCounterPromoCode(rawCode, subtotal, context = {}) {
  const session = await auth();
  if (!session?.user || !canAccessDashboard(session.user.role)) {
    return { success: false, message: "Accès non autorisé." };
  }
  const scope = PROMO_CODE_SCOPES.includes(context?.scope) ? context.scope : null;
  if (!scope) return { success: false, message: "Impossible de vérifier ce code pour le moment." };

  try {
    let base = Math.max(0, Number(subtotal) || 0);
    let lines = null;
    if (scope === "BOUTIQUE") {
      const items = Array.isArray(context.items) ? context.items.slice(0, 100) : [];
      const quantities = new Map();
      for (const item of items) {
        const variantId = String(item?.variantId ?? "");
        if (variantId) quantities.set(variantId, (quantities.get(variantId) ?? 0) + Math.max(0, Math.trunc(Number(item?.quantity) || 0)));
      }
      const variants = await prisma.productVariant.findMany({
        where: { id: { in: [...quantities.keys()] } },
        select: { id: true, productId: true, price: true },
      });
      lines = variants.map((v) => ({
        key: v.id,
        productId: v.productId,
        unitPrice: Number(v.price),
        quantity: quantities.get(v.id),
        amount: Number(v.price) * quantities.get(v.id),
      }));
      base = lines.reduce((sum, line) => sum + line.amount, 0);
    }

    let serviceId = null;
    if (scope === "APPOINTMENT" && typeof context.staffServiceId === "string" && context.staffServiceId) {
      const staffService = await prisma.staffService.findUnique({
        where: { id: context.staffServiceId },
        select: { serviceId: true },
      });
      serviceId = staffService?.serviceId ?? null;
    }

    const customerId = typeof context.customerId === "string" && context.customerId ? context.customerId : null;
    const result = await resolvePromoCode(rawCode, base, { scope, lines, serviceId, customerId, skipCustomerChecks: !customerId });
    if (!result.success) return result;
    return { success: true, discountAmount: result.discountAmount, appliedRules: result.appliedRules ?? [] };
  } catch (error) {
    console.error("[previewCounterPromoCode]", error);
    return { success: false, message: "Impossible de vérifier ce code pour le moment." };
  }
}
