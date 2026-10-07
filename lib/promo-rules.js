/**
 * The offers of a MULTI_RULE promo code — one code, several rules, each with
 * its own targets and mechanic (« -21 % sur ALBI », « 3 embouts achetés = 2
 * offerts »…). Pure and dependency-free: resolvePromoCode feeds it the code's
 * rules and the cart, and the same function prices the live preview and the
 * charge, so the two can never diverge.
 *
 * Everything is computed in integer cents, on the prices the buyer is
 * actually charged (TTC, or the HT base for a 0 % sale).
 *
 * A cart line is targeted by a rule when its product, subcategory, category
 * or brand is listed. Each rule is priced on its own over every line it
 * targets; when several rules target the same line, the one that discounts
 * it most wins — offers never stack. That is what makes a tiered offer a
 * plain pair of rules (« -15 % » + « -40 % dès 5 »).
 */

export const PROMO_RULE_KINDS = ["PERCENT_OFF", "NTH_DISCOUNTED", "BUY_X_GET_Y_FREE"];

const toCents = (amount) => Math.round(Number(amount) * 100);

function targetsLine(rule, line) {
  return (
    rule.productIds.includes(line.productId) ||
    (line.subcategoryId != null && rule.subcategoryIds.includes(line.subcategoryId)) ||
    (line.categoryId != null && rule.categoryIds.includes(line.categoryId)) ||
    (line.brandId != null && rule.brandIds.includes(line.brandId))
  );
}

/** One entry per unit sold, dearest first — the order groups are formed in. */
function unitsOf(lines) {
  const units = [];
  for (const line of lines) {
    for (let i = 0; i < line.quantity; i++) units.push({ key: line.key, priceCents: line.unitPriceCents });
  }
  return units.sort((a, b) => b.priceCents - a.priceCents);
}

function add(map, key, cents) {
  if (cents > 0) map.set(key, (map.get(key) ?? 0) + cents);
}

/** `percent` off every targeted line, once the cart holds `minQuantity` units. */
function percentOff(rule, lines) {
  const discounts = new Map();
  const quantity = lines.reduce((sum, line) => sum + line.quantity, 0);
  if (quantity < rule.minQuantity) return discounts;

  // Rounded once on the offer's whole base, then shared out by largest
  // remainder — three boxes on three lines cost what three on one line do.
  const shares = lines.map((line) => {
    const exact = (line.unitPriceCents * line.quantity * rule.percent) / 100;
    return { key: line.key, cents: Math.floor(exact), remainder: exact - Math.floor(exact) };
  });
  const total = Math.round(shares.reduce((sum, share) => sum + share.cents + share.remainder, 0));
  let leftover = total - shares.reduce((sum, share) => sum + share.cents, 0);
  for (const share of [...shares].sort((a, b) => b.remainder - a.remainder)) {
    if (leftover <= 0) break;
    share.cents += 1;
    leftover -= 1;
  }
  for (const share of shares) add(discounts, share.key, share.cents);
  return discounts;
}

/** Per group of `buyQuantity` + 1 units, the cheapest one is `percent` off. */
function nthDiscounted(rule, lines) {
  const discounts = new Map();
  const groupSize = rule.buyQuantity + 1;
  unitsOf(lines).forEach((unit, index) => {
    if ((index + 1) % groupSize === 0) add(discounts, unit.key, Math.round((unit.priceCents * rule.percent) / 100));
  });
  return discounts;
}

/**
 * Per group of `buyQuantity` + `freeQuantity` units, `freeQuantity` are free
 * — the cheapest of the group. With `samePriceOnly`, groups are only formed
 * between units sharing the same unit price.
 */
function buyXGetYFree(rule, lines) {
  const discounts = new Map();
  const groupSize = rule.buyQuantity + rule.freeQuantity;

  const buckets = new Map();
  for (const unit of unitsOf(lines)) {
    const bucketKey = rule.samePriceOnly ? unit.priceCents : "all";
    if (!buckets.has(bucketKey)) buckets.set(bucketKey, []);
    buckets.get(bucketKey).push(unit);
  }

  for (const units of buckets.values()) {
    const groups = Math.floor(units.length / groupSize);
    if (groups === 0) continue;

    if (rule.samePriceOnly) {
      // Every unit costs the same, so no one of them is « the free one »:
      // the lot's saving is shared out per unit (largest remainder). A return
      // then refunds the same amount whichever line the article sat on.
      const freeCents = groups * rule.freeQuantity * units[0].priceCents;
      const countByKey = new Map();
      for (const unit of units) countByKey.set(unit.key, (countByKey.get(unit.key) ?? 0) + 1);
      const shares = [...countByKey].map(([key, count]) => {
        const exact = (freeCents * count) / units.length;
        return { key, cents: Math.floor(exact), remainder: exact - Math.floor(exact) };
      });
      let leftover = freeCents - shares.reduce((sum, share) => sum + share.cents, 0);
      for (const share of [...shares].sort((a, b) => b.remainder - a.remainder)) {
        if (leftover <= 0) break;
        share.cents += 1;
        leftover -= 1;
      }
      for (const share of shares) add(discounts, share.key, share.cents);
      continue;
    }

    for (let group = 0; group < groups; group++) {
      const start = group * groupSize;
      for (const unit of units.slice(start + rule.buyQuantity, start + groupSize)) add(discounts, unit.key, unit.priceCents);
    }
  }
  return discounts;
}

const MECHANICS = {
  PERCENT_OFF: percentOff,
  NTH_DISCOUNTED: nthDiscounted,
  BUY_X_GET_Y_FREE: buyXGetYFree,
};

function normalizeRule(rule) {
  return {
    id: rule.id,
    label: rule.label,
    kind: rule.kind,
    percent: Number(rule.percent ?? 0),
    minQuantity: Math.max(1, Number(rule.minQuantity ?? 1)),
    buyQuantity: Math.max(1, Number(rule.buyQuantity ?? 1)),
    freeQuantity: Math.max(1, Number(rule.freeQuantity ?? 1)),
    samePriceOnly: Boolean(rule.samePriceOnly),
    brandIds: rule.brandIds ?? [],
    categoryIds: rule.categoryIds ?? [],
    subcategoryIds: rule.subcategoryIds ?? [],
    productIds: rule.productIds ?? [],
  };
}

/**
 * Prices a cart against a code's rules.
 *
 * `rules`: [{ id, label, kind, percent, minQuantity, buyQuantity, freeQuantity,
 *   samePriceOnly, brandIds, categoryIds, subcategoryIds, productIds }]
 * `lines`: [{ key, productId, subcategoryId, categoryId, brandId, unitPrice, quantity }]
 *   — `key` identifies the cart line (its variant id).
 *
 * Returns, in euros:
 *  - discountAmount: the whole discount
 *  - lineDiscounts: [{ key, discountAmount, label }] — only discounted lines
 *  - appliedRules: [{ ruleId, label, discountAmount }] — only offers that won
 *    at least one line, in the code's own order
 */
export function computeRuleDiscounts(rules, lines) {
  const cart = (lines ?? [])
    .map((line) => ({ ...line, unitPriceCents: toCents(line.unitPrice), quantity: Math.trunc(Number(line.quantity)) }))
    .filter((line) => line.quantity > 0 && line.unitPriceCents > 0);

  const best = new Map();
  for (const rawRule of rules ?? []) {
    const rule = normalizeRule(rawRule);
    const mechanic = MECHANICS[rule.kind];
    if (!mechanic) continue;
    const targeted = cart.filter((line) => targetsLine(rule, line));
    if (targeted.length === 0) continue;

    for (const [key, cents] of mechanic(rule, targeted)) {
      if (cents > (best.get(key)?.cents ?? 0)) best.set(key, { cents, rule });
    }
  }

  const lineDiscounts = [];
  const byRule = new Map();
  let totalCents = 0;
  for (const line of cart) {
    const won = best.get(line.key);
    if (!won) continue;
    const cents = Math.min(won.cents, line.unitPriceCents * line.quantity);
    totalCents += cents;
    lineDiscounts.push({ key: line.key, discountAmount: cents / 100, label: won.rule.label });
    byRule.set(won.rule.id, (byRule.get(won.rule.id) ?? 0) + cents);
  }

  const appliedRules = (rules ?? [])
    .filter((rule) => byRule.has(rule.id))
    .map((rule) => ({ ruleId: rule.id, label: rule.label, discountAmount: byRule.get(rule.id) / 100 }));

  return { discountAmount: totalCents / 100, lineDiscounts, appliedRules };
}
