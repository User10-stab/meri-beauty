import { prisma } from "@/lib/prisma";
import { PROMO_CODE_SCOPES } from "@/lib/promo-code-scopes";
import { computeRuleDiscounts } from "@/lib/promo-rules";

const SCOPE_REJECTION = {
  BOUTIQUE: "Ce code promo n'est pas valable sur la boutique.",
  APPOINTMENT: "Ce code promo n'est pas valable pour les rendez-vous.",
  WORKSHOP: "Ce code promo n'est pas valable pour les ateliers.",
  FORMATION: "Ce code promo n'est pas valable pour les formations.",
};

const roundCents = (n) => Math.round(Number(n) * 100) / 100;

/**
 * Computes the discount a code grants against a given base, without
 * touching the DB — shared by validatePromoCode's live preview and every
 * create action's server-side re-validation, so the two can never diverge.
 * `base` is the part of the purchase the code applies to (the whole
 * subtotal, or only the targeted products' lines).
 */
function computeDiscount(promo, base) {
  const raw = promo.type === "PERCENTAGE" ? (base * Number(promo.value)) / 100 : Number(promo.value);
  // Stripe coupons and persisted money both operate in cents. Rounding once
  // here keeps the order total and Stripe's amount_off derived from the same
  // figure, including half-cent percentage discounts.
  return Math.min(roundCents(raw), roundCents(base));
}

/**
 * How many times this customer has already used the code, counted from the
 * live sales/bookings that carry it rather than from a separate ledger — a
 * cancelled order, an expired unpaid hold or a cancelled/rejected rendez-vous
 * therefore frees the use again on its own, with no release hook to forget in
 * every cancellation path.
 */
export async function countCustomerPromoUses(db, promoCodeId, customerId) {
  if (!promoCodeId || !customerId) return 0;
  const now = new Date();

  const orders = await db.order.count({
    where: {
      promoCodeId,
      userId: customerId,
      status: { notIn: ["CANCELLED", "EXPIRED", "SETTLED_AT_COUNTER"] },
      OR: [{ status: { not: "PENDING_PAYMENT" } }, { expiresAt: null }, { expiresAt: { gte: now } }],
    },
  });
  const liveHold = {
    status: { not: "CANCELLED" },
    OR: [{ status: { not: "PENDING_DEPOSIT" } }, { holdExpiresAt: null }, { holdExpiresAt: { gte: now } }],
  };
  const workshops = await db.workshopReservation.count({ where: { promoCodeId, customerId, ...liveHold } });
  const formations = await db.formationReservation.count({ where: { promoCodeId, customerId, ...liveHold } });
  // Only the appointment's own status frees it — the rule releaseAppointmentPromoUse
  // applies to usedCount. A FAILED online payment is not an end: the customer
  // can still pay it through the retry link.
  const appointments = await db.payment.count({
    where: {
      promoCodeId,
      appointment: { is: { userId: customerId, status: { notIn: ["CANCELLED", "REJECTED"] } } },
    },
  });

  return orders + workshops + formations + appointments;
}

/**
 * Looks up a code and validates it against a purchase — used both for the
 * client-side live preview (`validatePromoCode` in actions/promo-codes.js)
 * and internally by every create action right before charging, so a client
 * can never hand over a pre-computed discount and have it trusted.
 *
 * `context`:
 *  - scope: "BOUTIQUE" | "APPOINTMENT" | "WORKSHOP" | "FORMATION" (required)
 *  - customerId: the buying customer's User id (null for an anonymous preview)
 *  - lines: BOUTIQUE only — [{ key, productId, unitPrice, quantity, amount }]
 *    (amount = line total as charged; key = unique per line). A MULTI_RULE
 *    code prices each line by its own offer and also returns `lineDiscounts`
 *    ([{ key, discountAmount, label }]), `appliedRules` and `snapshot` (to
 *    store on the order — `key` must then be the line's variant id).
 *  - serviceId: APPOINTMENT only — the prestation's Service id
 *  - skipCustomerChecks: preview for a guest whose account isn't known yet;
 *    the customer rules are then enforced at submit instead.
 *  - db: a transaction client, to read the code as the caller's own
 *    transaction sees it (defaults to prisma).
 *
 * Deliberately kept out of any "use server" module — every export from a
 * "use server" file is a public, unauthenticated POST endpoint. This one is
 * meant to be called only from other server-side code (never directly by a
 * client), unlike validatePromoCode which is the intentionally-public,
 * stripped-down preview version.
 */
export async function resolvePromoCode(rawCode, subtotal, context = {}) {
  const code = rawCode?.trim().toUpperCase();
  if (!code) return { success: false, message: "Veuillez entrer un code." };
  const { scope, customerId = null, lines = null, serviceId = null, skipCustomerChecks = false, db = prisma } = context;
  if (!PROMO_CODE_SCOPES.includes(scope)) throw new Error(`resolvePromoCode: unknown scope "${scope}"`);

  const promo = await db.promoCode.findUnique({
    where: { code },
    include: {
      products: { select: { id: true } },
      services: { select: { id: true } },
      customers: { select: { id: true } },
    },
  });
  if (!promo || !promo.isActive) {
    return { success: false, message: "Ce code promo n'existe pas ou n'est plus valide." };
  }
  if (promo.expiresAt && promo.expiresAt < new Date()) {
    return { success: false, message: "Ce code promo a expiré." };
  }
  if (promo.maxUses != null && promo.usedCount >= promo.maxUses) {
    return { success: false, message: "Ce code promo a atteint sa limite d'utilisation." };
  }
  if (!(promo.scopes ?? PROMO_CODE_SCOPES).includes(scope)) {
    return { success: false, message: SCOPE_REJECTION[scope] };
  }
  if (promo.minOrderAmount != null && subtotal < Number(promo.minOrderAmount)) {
    return {
      success: false,
      message: `Ce code nécessite un montant minimum de ${Number(promo.minOrderAmount).toFixed(2)} €.`,
    };
  }

  if (promo.type === "MULTI_RULE") {
    if (!skipCustomerChecks) {
      const eligibility = await checkCustomerRules(promo, customerId, db);
      if (!eligibility.success) return eligibility;
    }
    const offers = await priceMultiRuleCode(promo, lines, db);
    if (offers.discountAmount <= 0) {
      return { success: false, message: "Aucune offre de ce code ne s'applique à votre panier pour le moment." };
    }
    return { success: true, promoCodeId: promo.id, ...offers, maxUses: promo.maxUses, maxUsesPerCustomer: promo.maxUsesPerCustomer };
  }

  // What the discount is computed on — the whole purchase unless the code
  // targets specific products (only those lines) or prestations (all or nothing).
  let base = Number(subtotal);
  if (scope === "BOUTIQUE" && promo.products.length > 0) {
    const targeted = new Set(promo.products.map((p) => p.id));
    base = roundCents((lines ?? []).reduce((sum, l) => (targeted.has(l.productId) ? sum + Number(l.amount) : sum), 0));
    if (base <= 0) {
      return { success: false, message: "Ce code promo ne s'applique à aucun article de votre panier." };
    }
  }
  if (scope === "APPOINTMENT" && promo.services.length > 0 && !promo.services.some((s) => s.id === serviceId)) {
    return { success: false, message: "Ce code promo n'est pas valable pour cette prestation." };
  }

  if (!skipCustomerChecks) {
    const eligibility = await checkCustomerRules(promo, customerId, db);
    if (!eligibility.success) return eligibility;
  }

  return {
    success: true,
    promoCodeId: promo.id,
    discountAmount: computeDiscount(promo, base),
    // Passed through so the caller can re-check both caps atomically at
    // actual booking time (claimPromoCodeUse, inside its own transaction) —
    // this read-only check only tells you a code LOOKED available a moment
    // ago, not that it still is once you're ready to commit.
    maxUses: promo.maxUses,
    maxUsesPerCustomer: promo.maxUsesPerCustomer,
  };
}

/**
 * A MULTI_RULE code's discount on a boutique cart: each cart line is placed
 * in the catalogue tree (its brand is only known through its subcategory),
 * then priced by computeRuleDiscounts. Needs lines carrying `key`,
 * `unitPrice` and `quantity` — a caller still sending bare amounts gets no
 * discount rather than a wrong one.
 */
async function priceMultiRuleCode(promo, lines, db) {
  const cart = (lines ?? []).filter((l) => l.productId && l.key != null && Number(l.quantity) > 0);
  if (cart.length === 0) return { discountAmount: 0, lineDiscounts: [], appliedRules: [] };

  const [rules, products] = await Promise.all([
    db.promoCodeRule.findMany({
      where: { promoCodeId: promo.id },
      orderBy: { position: "asc" },
      include: {
        brands: { select: { id: true } },
        categories: { select: { id: true } },
        subcategories: { select: { id: true } },
        products: { select: { id: true } },
      },
    }),
    db.product.findMany({
      where: { id: { in: [...new Set(cart.map((l) => l.productId))] } },
      select: { id: true, subcategoryId: true, subcategory: { select: { categoryId: true, category: { select: { brandId: true } } } } },
    }),
  ]);
  const placeById = new Map(products.map((p) => [p.id, p]));

  // Plain data only — this is also what the order keeps (Order.promoSnapshot)
  // so a later return can re-price what the client keeps with these very
  // offers, whatever happens to the code or the catalogue in between.
  const offers = rules.map((rule) => ({
    id: rule.id,
    label: rule.label,
    kind: rule.kind,
    percent: rule.percent != null ? Number(rule.percent) : null,
    minQuantity: rule.minQuantity,
    buyQuantity: rule.buyQuantity,
    freeQuantity: rule.freeQuantity,
    samePriceOnly: rule.samePriceOnly,
    brandIds: rule.brands.map((b) => b.id),
    categoryIds: rule.categories.map((c) => c.id),
    subcategoryIds: rule.subcategories.map((s) => s.id),
    productIds: rule.products.map((p) => p.id),
  }));
  const placements = cart.map((l) => {
    const place = placeById.get(l.productId);
    return {
      key: l.key,
      productId: l.productId,
      subcategoryId: place?.subcategoryId ?? null,
      categoryId: place?.subcategory?.categoryId ?? null,
      brandId: place?.subcategory?.category?.brandId ?? null,
    };
  });

  return {
    ...computeRuleDiscounts(
      offers,
      cart.map((l, index) => ({ ...placements[index], unitPrice: l.unitPrice, quantity: l.quantity }))
    ),
    snapshot: { rules: offers, placements },
  };
}

async function checkCustomerRules(promo, customerId, db = prisma) {
  if (promo.customers.length > 0 && !promo.customers.some((c) => c.id === customerId)) {
    return { success: false, message: "Ce code promo est réservé à un autre client." };
  }
  if (promo.maxUsesPerCustomer != null && customerId) {
    const used = await countCustomerPromoUses(db, promo.id, customerId);
    if (used >= promo.maxUsesPerCustomer) {
      return { success: false, message: customerLimitMessage(promo.maxUsesPerCustomer) };
    }
  }
  return { success: true };
}

/**
 * The customer half of resolvePromoCode, for a flow that prices the purchase
 * before it knows who the customer is (resolved with skipCustomerChecks) and
 * must still enforce "reserved for" / "max per customer" once it does.
 *
 * `db` lets a caller count uses inside its own transaction — the till does,
 * so a pickup order it has just closed in that transaction no longer counts.
 */
export async function checkPromoCustomerEligibility(promoCodeId, customerId, db = prisma) {
  const promo = await db.promoCode.findUnique({
    where: { id: promoCodeId },
    select: { id: true, maxUsesPerCustomer: true, customers: { select: { id: true } } },
  });
  if (!promo) return { success: false, message: "Ce code promo n'existe pas ou n'est plus valide." };
  return checkCustomerRules(promo, customerId, db);
}

export function customerLimitMessage(max) {
  return max === 1
    ? "Vous avez déjà utilisé ce code promo."
    : `Vous avez déjà utilisé ce code promo ${max} fois (limite par client atteinte).`;
}

/**
 * Claims one use of a code inside the caller's booking transaction — call it
 * BEFORE creating the order/reservation/payment row that carries the code, so
 * the per-customer count doesn't include the row being created.
 *
 * Throws "PROMO_CUSTOMER_LIMIT" or "PROMO_EXHAUSTED" (callers map both to a
 * customer-facing message and roll the whole booking back).
 */
export async function claimPromoCodeUse(tx, { promoCodeId, maxUses, maxUsesPerCustomer, customerId }) {
  if (!promoCodeId) return;

  if (maxUsesPerCustomer != null && customerId) {
    // Serialises every claim of this code, so two parallel checkouts by the
    // same customer can't both read the same count and both pass.
    await tx.$queryRaw`SELECT id FROM "PromoCode" WHERE id = ${promoCodeId} FOR UPDATE`;
    const used = await countCustomerPromoUses(tx, promoCodeId, customerId);
    if (used >= maxUsesPerCustomer) throw new Error("PROMO_CUSTOMER_LIMIT");
  }

  // Atomic conditional claim — only succeeds while usedCount is still under
  // the cap captured moments ago at resolvePromoCode time. Two concurrent
  // checkouts racing the last use of a capped code can't both win: the
  // loser's WHERE clause matches zero rows.
  if (maxUses != null) {
    const claim = await tx.promoCode.updateMany({
      where: { id: promoCodeId, usedCount: { lt: maxUses } },
      data: { usedCount: { increment: 1 } },
    });
    if (claim.count === 0) throw new Error("PROMO_EXHAUSTED");
  } else {
    await tx.promoCode.update({ where: { id: promoCodeId }, data: { usedCount: { increment: 1 } } });
  }
}

/** Customer-facing message for an error thrown by claimPromoCodeUse, or null. */
export function promoClaimErrorMessage(error) {
  if (error?.message === "PROMO_EXHAUSTED") return "Ce code promo vient d'atteindre sa limite d'utilisation.";
  if (error?.message === "PROMO_CUSTOMER_LIMIT") return "Vous avez déjà utilisé ce code promo le nombre de fois autorisé.";
  return null;
}

/** A promo code refused at the till — `message` is safe to show the cashier. */
export class CounterPromoCodeError extends Error {}

/**
 * The till's resolve + claim in one step, run inside the sale's own
 * transaction so everything it reads (usedCount, the client's past uses)
 * is what that transaction sees — including a pickup order it has just
 * closed and whose use it has just given back. Same rules as online: the
 * scope, the targeted products/prestations, the minimum, the caps.
 *
 * A code reserved for some clients or capped per client needs a named
 * client — a « client de passage » can't be counted against either rule.
 *
 * Returns { promoCodeId, discountAmount, lineDiscounts }; throws CounterPromoCodeError.
 */
export async function applyCounterPromoCode(tx, rawCode, subtotal, { scope, customerId = null, lines = null, serviceId = null }) {
  const resolved = await resolvePromoCode(rawCode, subtotal, { scope, lines, serviceId, skipCustomerChecks: true, db: tx });
  if (!resolved.success) throw new CounterPromoCodeError(resolved.message);

  const eligibility = await checkPromoCustomerEligibility(resolved.promoCodeId, customerId, tx);
  if (!customerId && (resolved.maxUsesPerCustomer != null || !eligibility.success)) {
    throw new CounterPromoCodeError("Ce code promo est lié à un client : identifiez le client pour l'appliquer.");
  }
  if (!eligibility.success) throw new CounterPromoCodeError(eligibility.message);

  try {
    await claimPromoCodeUse(tx, {
      promoCodeId: resolved.promoCodeId,
      maxUses: resolved.maxUses,
      maxUsesPerCustomer: resolved.maxUsesPerCustomer,
      customerId,
    });
  } catch (error) {
    const message = promoClaimErrorMessage(error);
    if (message) throw new CounterPromoCodeError(message);
    throw error;
  }
  return {
    promoCodeId: resolved.promoCodeId,
    discountAmount: resolved.discountAmount,
    lineDiscounts: resolved.lineDiscounts ?? [],
    snapshot: resolved.snapshot ?? null,
  };
}
