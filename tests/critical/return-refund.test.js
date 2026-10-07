import { describe, expect, it } from "vitest";
import { computeReturnGoodsRefund, computeReturnRefund } from "@/lib/orders/return-refund";
import { computeRuleDiscounts } from "@/lib/promo-rules";

/**
 * Returns on an order paid with a multi-offer code: the client is refunded
 * what she paid beyond the price of the articles she keeps — she can't buy a
 * lot for its price and send most of it back.
 */
const NO_TARGETS = { brandIds: [], categoryIds: [], subcategoryIds: [], productIds: [] };
const RULES = [
  { id: "klyn", label: "KLYN", kind: "PERCENT_OFF", percent: 15, minQuantity: 2, ...NO_TARGETS, brandIds: ["klyn"] },
  { id: "embouts", label: "Embouts", kind: "BUY_X_GET_Y_FREE", buyQuantity: 3, freeQuantity: 2, samePriceOnly: true, ...NO_TARGETS, categoryIds: ["embouts"] },
  { id: "cire", label: "Cire", kind: "PERCENT_OFF", percent: 15, minQuantity: 1, ...NO_TARGETS, productIds: ["cire"] },
  { id: "cire-5", label: "Cire dès 5", kind: "PERCENT_OFF", percent: 40, minQuantity: 5, ...NO_TARGETS, productIds: ["cire"] },
];
const PLACE = {
  cire: { productId: "cire", brandId: "meribeauty", categoryId: "soins", subcategoryId: null },
  klynA: { productId: "klyn-a", brandId: "klyn", categoryId: "popits", subcategoryId: null },
  klynB: { productId: "klyn-b", brandId: "klyn", categoryId: "popits", subcategoryId: null },
  embout: { productId: "embout", brandId: "meribeauty", categoryId: "embouts", subcategoryId: null },
  lime: { productId: "lime", brandId: "staleks", categoryId: "limes", subcategoryId: null },
};

/** An order as createOrderFromCart stores it: per-line discounts + the snapshot. */
function order(lines, { shippingCost = 0, returnRequests = [] } = {}) {
  const cart = lines.map(([variantId, unitPrice, quantity]) => ({ key: variantId, ...PLACE[variantId], unitPrice, quantity }));
  const priced = computeRuleDiscounts(RULES, cart);
  const discountByKey = new Map(priced.lineDiscounts.map((line) => [line.key, line.discountAmount]));
  return {
    discountAmount: priced.discountAmount,
    shippingCost,
    returnRequests,
    promoSnapshot: { rules: RULES, placements: cart.map(({ key, productId, brandId, categoryId, subcategoryId }) => ({ key, productId, brandId, categoryId, subcategoryId })) },
    items: cart.map((line) => ({ id: `item-${line.key}`, variantId: line.key, unitPrice: line.unitPrice, quantity: line.quantity, discountAmount: discountByKey.get(line.key) ?? 0 })),
  };
}
const back = (variantId, quantity) => ({ orderItemId: `item-${variantId}`, quantity });
const refund = (o, returnItems, previouslyReturned) => computeReturnGoodsRefund({ order: o, returnItems, previouslyReturned });

describe("computeReturnGoodsRefund — multi-offer orders", () => {
  it("5 cires at -40 %, 4 sent back: the one she keeps is back to -15 %", () => {
    // Paid 44,70 €. One cire alone costs 12,66 € → 32,04 €, not 4 × 8,94 € = 35,76 €.
    expect(refund(order([["cire", 14.9, 5]]), [back("cire", 4)])).toEqual({ amount: 32.04, recalculated: true });
  });

  it("5 embouts paid as 3, 2 sent back: she keeps 3 at full price, nothing is owed", () => {
    // Paid 14,85 € and three embouts cost 14,85 €.
    expect(refund(order([["embout", 4.95, 5]]), [back("embout", 2)]).amount).toBe(0);
  });

  it("2 KLYN at -15 %, 1 sent back: the box she keeps is full price", () => {
    // Paid 44,11 € (51,90 − 7,79); one box costs 25,95 €.
    expect(refund(order([["klynA", 25.95, 1], ["klynB", 25.95, 1]]), [back("klynA", 1)]).amount).toBe(18.16);
  });

  it("refunds everything paid when the whole order comes back", () => {
    const o = order([["cire", 14.9, 5], ["embout", 4.95, 5], ["lime", 12, 1]]);
    expect(refund(o, [back("cire", 5), back("embout", 5), back("lime", 1)]).amount).toBe(71.55);
  });

  it("refunds an article no offer touches at its full price", () => {
    expect(refund(order([["cire", 14.9, 5], ["lime", 12, 1]]), [back("lime", 1)]).amount).toBe(12);
  });

  it("never goes negative: 5 cires, one sent back — four at -15 % cost more than the five did", () => {
    expect(refund(order([["cire", 14.9, 5]]), [back("cire", 1)]).amount).toBe(0);
  });

  it("picks up from earlier returns, never refunding more than was paid in total", () => {
    const o = order([["cire", 14.9, 5]]);
    // First return (1 cire) refunded nothing; the other four then give back all 44,70 €.
    expect(refund(o, [back("cire", 4)], new Map([["item-cire", 1]])).amount).toBe(44.7);

    // 6 cires (53,64 €): 1 back → 8,94 € ; 4 more back → she keeps 1 at 12,66 € → 40,98 € owed in all.
    const six = order([["cire", 14.9, 6]]);
    const first = refund(six, [back("cire", 1)]).amount;
    const second = refund(six, [back("cire", 4)], new Map([["item-cire", 1]])).amount;
    expect(first).toBe(8.94);
    expect(Math.round((first + second) * 100)).toBe(4098);
  });
});

describe("computeReturnGoodsRefund — orders without a multi-offer code", () => {
  const classic = {
    discountAmount: 10,
    items: [
      { id: "a", variantId: "va", unitPrice: 30, quantity: 2, discountAmount: 0 },
      { id: "b", variantId: "vb", unitPrice: 40, quantity: 1, discountAmount: 0 },
    ],
  };

  it("gives each returned unit back at its net price, as before", () => {
    // 10 € prorated: 6 € on a (2 × 30), 4 € on b.
    expect(computeReturnGoodsRefund({ order: classic, returnItems: [{ orderItemId: "a", quantity: 1 }] })).toEqual({ amount: 27, recalculated: false });
    expect(computeReturnGoodsRefund({ order: classic, returnItems: [{ orderItemId: "b", quantity: 1 }] }).amount).toBe(36);
  });

  it("refunds the plain price when there is no discount at all", () => {
    const plain = { ...classic, discountAmount: 0 };
    expect(computeReturnGoodsRefund({ order: plain, returnItems: [{ orderItemId: "a", quantity: 2 }] }).amount).toBe(60);
  });
});

describe("computeReturnRefund — shipping", () => {
  it("adds the shipping only once every unit is back, counting completed requests", () => {
    const earlier = { id: "r1", status: "COMPLETED", items: [back("cire", 4)] };
    const pending = { id: "r3", status: "APPROVED", items: [back("lime", 1)] };
    const o = order([["cire", 14.9, 5], ["lime", 12, 1]], { shippingCost: 6.5, returnRequests: [earlier, pending] });

    const partial = computeReturnRefund({ order: o, request: { id: "r2", items: [back("cire", 1)] } });
    expect(partial.shipping).toBe(0);

    const last = computeReturnRefund({ order: o, request: { id: "r2", items: [back("cire", 1), back("lime", 1)] } });
    expect(last).toMatchObject({ shipping: 6.5, recalculated: true });
    // Paid 56,70 € for the goods, 32,04 € already refunded by r1.
    expect(Math.round(last.goods * 100)).toBe(2466);
    expect(Math.round(last.total * 100)).toBe(3116);
  });
});
