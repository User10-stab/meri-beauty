import { allocateOrderDiscount } from "@/lib/orders/discount-allocation";
import { computeRuleDiscounts } from "@/lib/promo-rules";

const toCents = (amount) => Math.round(Number(amount) * 100);

/**
 * What a return refunds for the goods themselves (shipping is the caller's).
 *
 * A classic code spreads its discount over the lines, so each returned unit
 * simply gives back its net price (allocateOrderDiscount).
 *
 * A multi-offer code (Order.promoSnapshot) is different: its offers depend on
 * how many articles the client buys — « -40 % dès 5 cires », « 3 embouts
 * achetés = 2 offerts ». Refunding the net price of a returned unit would let
 * her keep a lot's price on what she keeps (buy 5 cires at -40 %, send 4
 * back, keep one at -40 %). So the articles she KEEPS are re-priced with the
 * very offers of her order, and she is owed what she paid beyond that:
 *
 *   owed so far = max(0, paid for the goods − price of what she still keeps)
 *   this refund = owed after this return − owed before it
 *
 * Never negative: when what she keeps is worth more than she paid (5 cires at
 * -40 %, one sent back: four at -15 % cost more than the five did), this
 * return refunds nothing and a later one picks up from there.
 *
 * `order`: { discountAmount, promoSnapshot, items: [{ id, variantId, unitPrice, quantity, discountAmount }] }
 * `returnItems`: [{ orderItemId, quantity }] — this request
 * `previouslyReturned`: Map(orderItemId → units already back, from COMPLETED requests)
 *
 * Returns { amount (euros), recalculated }.
 */
export function computeReturnGoodsRefund({ order, returnItems, previouslyReturned = new Map() }) {
  const rules = order.promoSnapshot?.rules;
  if (!Array.isArray(rules) || rules.length === 0) {
    const netByItemId = allocateOrderDiscount(order);
    const quantityByItemId = new Map(order.items.map((item) => [item.id, item.quantity]));
    const unitPriceByItemId = new Map(order.items.map((item) => [item.id, Number(item.unitPrice)]));
    const amount = returnItems.reduce((sum, returned) => {
      const quantity = quantityByItemId.get(returned.orderItemId);
      if (!quantity) return sum;
      const netForFullQuantity = netByItemId.get(returned.orderItemId) ?? unitPriceByItemId.get(returned.orderItemId) * quantity;
      return sum + (netForFullQuantity / quantity) * returned.quantity;
    }, 0);
    return { amount, recalculated: false };
  }

  const placementByVariantId = new Map((order.promoSnapshot.placements ?? []).map((placement) => [placement.key, placement]));
  // Price of a set of kept quantities (Map orderItemId → units), in cents.
  const priceOf = (keptByItemId) => {
    const lines = order.items.map((item) => ({
      ...(placementByVariantId.get(item.variantId) ?? {}),
      key: item.id,
      unitPrice: Number(item.unitPrice),
      quantity: Math.max(0, keptByItemId.get(item.id) ?? 0),
    }));
    const faceCents = lines.reduce((sum, line) => sum + toCents(line.unitPrice) * line.quantity, 0);
    return faceCents - toCents(computeRuleDiscounts(rules, lines).discountAmount);
  };

  const bought = new Map(order.items.map((item) => [item.id, item.quantity]));
  const keptBefore = new Map(order.items.map((item) => [item.id, item.quantity - (previouslyReturned.get(item.id) ?? 0)]));
  const keptAfter = new Map(keptBefore);
  for (const returned of returnItems) {
    keptAfter.set(returned.orderItemId, (keptAfter.get(returned.orderItemId) ?? 0) - returned.quantity);
  }

  const paidCents = priceOf(bought);
  const owedBefore = Math.max(0, paidCents - priceOf(keptBefore));
  const owedAfter = Math.max(0, paidCents - priceOf(keptAfter));
  return { amount: Math.max(0, owedAfter - owedBefore) / 100, recalculated: true };
}

/**
 * Everything one return request refunds — the goods, plus the shipping once
 * every unit of the order is back. Shared by the staff preview and by
 * completeReturnRequest, so the amount staff read is the amount recorded.
 *
 * `order`: as computeReturnGoodsRefund, plus `shippingCost` and
 * `returnRequests` ([{ id, status, items: [{ orderItemId, quantity }] }]).
 * `request`: { id, items: [{ orderItemId, quantity }] } — counted as returned.
 *
 * Returns { goods, shipping, total, recalculated } in euros.
 */
export function computeReturnRefund({ order, request }) {
  const previouslyReturned = completedReturnQuantities(order.returnRequests, { excludeId: request.id });
  const { amount: goods, recalculated } = computeReturnGoodsRefund({ order, returnItems: request.items, previouslyReturned });

  // Only COMPLETED requests (items physically confirmed back) and this one
  // count — an APPROVED request is "cleared to return", not proof it came back.
  const returned = new Map(previouslyReturned);
  for (const item of request.items) returned.set(item.orderItemId, (returned.get(item.orderItemId) ?? 0) + item.quantity);
  const fullyReturned = order.items.every((item) => (returned.get(item.id) ?? 0) >= item.quantity);
  const shipping = fullyReturned ? Number(order.shippingCost ?? 0) : 0;

  return { goods, shipping, total: goods + shipping, recalculated };
}

/** Units already back per order item — only COMPLETED requests count. */
export function completedReturnQuantities(returnRequests, { excludeId = null } = {}) {
  const returned = new Map();
  for (const request of returnRequests ?? []) {
    if (request.id === excludeId || request.status !== "COMPLETED") continue;
    for (const item of request.items) returned.set(item.orderItemId, (returned.get(item.orderItemId) ?? 0) + item.quantity);
  }
  return returned;
}
