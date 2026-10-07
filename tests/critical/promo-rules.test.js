import { describe, expect, it } from "vitest";
import { computeRuleDiscounts } from "@/lib/promo-rules";
import { allocateOrderDiscount } from "@/lib/orders/discount-allocation";
import { promoCodeSchema } from "@/lib/validations/promo-codes";

/**
 * The ESTETIKA code as Marie described it — every figure below is one she
 * was shown and confirmed, on the real catalogue prices.
 */
const NO_TARGETS = { brandIds: [], categoryIds: [], subcategoryIds: [], productIds: [] };
const rule = (id, fields) => ({ id, label: id, minQuantity: 1, samePriceOnly: false, ...NO_TARGETS, ...fields });

const ESTETIKA = [
  rule("albi", { kind: "PERCENT_OFF", percent: 21, brandIds: ["albi", "the-base", "black-pro"] }),
  rule("klyn", { kind: "PERCENT_OFF", percent: 15, minQuantity: 2, brandIds: ["klyn"] }),
  rule("purple", { kind: "PERCENT_OFF", percent: 10, brandIds: ["purple", "american-creator"] }),
  rule("atelier", { kind: "NTH_DISCOUNTED", buyQuantity: 2, percent: 50, brandIds: ["atelier"] }),
  rule("embouts", { kind: "BUY_X_GET_Y_FREE", buyQuantity: 3, freeQuantity: 2, samePriceOnly: true, categoryIds: ["embouts"] }),
  rule("cire", { kind: "PERCENT_OFF", percent: 15, productIds: ["cire"] }),
  rule("cire-5", { kind: "PERCENT_OFF", percent: 40, minQuantity: 5, productIds: ["cire"] }),
];

let lineSeq = 0;
const line = (unitPrice, quantity, target) => ({
  key: `line-${++lineSeq}`,
  productId: `product-${lineSeq}`,
  subcategoryId: null,
  categoryId: null,
  brandId: null,
  unitPrice,
  quantity,
  ...target,
});
const klyn = (quantity) => line(25.95, quantity, { brandId: "klyn" });
const cire = (quantity) => line(14.9, quantity, { productId: "cire", brandId: "meribeauty", categoryId: "soins" });
const embout = (unitPrice, quantity) => line(unitPrice, quantity, { brandId: "meribeauty", categoryId: "embouts" });
const atelier = (unitPrice, quantity = 1) => line(unitPrice, quantity, { brandId: "atelier" });

const discount = (lines) => computeRuleDiscounts(ESTETIKA, lines).discountAmount;

describe("computeRuleDiscounts — percentage offers", () => {
  it("takes 21 % off a targeted brand from the first unit", () => {
    expect(discount([line(20, 1, { brandId: "albi" })])).toBe(4.2);
  });

  it("leaves untargeted products at full price", () => {
    const result = computeRuleDiscounts(ESTETIKA, [line(30, 2, { brandId: "staleks" })]);
    expect(result).toEqual({ discountAmount: 0, lineDiscounts: [], appliedRules: [] });
  });

  it("KLYN: one box is full price, three boxes are all at -15 % (66,17 €)", () => {
    expect(discount([klyn(1)])).toBe(0);
    expect(discount([klyn(3)])).toBe(11.68);
  });

  it("KLYN: different Pop-Its count together and cost the same as one line", () => {
    const result = computeRuleDiscounts(ESTETIKA, [klyn(1), klyn(1), klyn(1)]);
    expect(result.discountAmount).toBe(11.68);
    expect(result.lineDiscounts.map((l) => l.discountAmount).sort()).toEqual([3.89, 3.89, 3.9]);
  });
});

describe("computeRuleDiscounts — tiered offer (cires)", () => {
  it("is -15 % each below five", () => {
    expect(discount([cire(4)])).toBe(8.94);
  });

  it("is -40 % on every wax from five (6 cires = 53,64 €)", () => {
    const result = computeRuleDiscounts(ESTETIKA, [cire(6)]);
    expect(result.discountAmount).toBe(35.76);
    // The two tiers never stack: only the winning offer is reported.
    expect(result.appliedRules).toEqual([{ ruleId: "cire-5", label: "cire-5", discountAmount: 35.76 }]);
  });
});

describe("computeRuleDiscounts — 2 achetés, le 3e à -50 %", () => {
  it("halves the cheapest of three mixed products", () => {
    const lines = [atelier(20), atelier(15), atelier(12)];
    const result = computeRuleDiscounts(ESTETIKA, lines);
    expect(result.discountAmount).toBe(6);
    expect(result.lineDiscounts).toEqual([{ key: lines[2].key, discountAmount: 6, label: "atelier" }]);
  });

  it("does nothing for two products and discounts one per group of three", () => {
    expect(discount([atelier(20), atelier(15)])).toBe(0);
    // 20 20 [15] 12 12 [10] → 7,50 + 5
    expect(discount([atelier(20, 2), atelier(15), atelier(12, 2), atelier(10)])).toBe(12.5);
  });
});

describe("computeRuleDiscounts — 3 embouts achetés = 2 offerts", () => {
  it("gives two of five same-price embouts for free (14,85 €)", () => {
    expect(discount([embout(4.95, 5)])).toBe(9.9);
    expect(discount([embout(4.95, 2), embout(4.95, 3)])).toBe(9.9);
  });

  it("shares the saving between the lines of a lot, so no line ends up free", () => {
    const lines = [embout(4.95, 2), embout(4.95, 3)];
    const result = computeRuleDiscounts(ESTETIKA, lines);
    expect(result.lineDiscounts.map((l) => l.discountAmount)).toEqual([3.96, 5.94]);
  });

  it("gives nothing for three or four embouts", () => {
    expect(discount([embout(4.95, 3)])).toBe(0);
    expect(discount([embout(4.95, 4)])).toBe(0);
  });

  it("never mixes embouts of different prices", () => {
    expect(discount([embout(4.95, 3), embout(14.95, 2)])).toBe(0);
    expect(discount([embout(4.95, 5), embout(14.95, 4)])).toBe(9.9);
  });

  it("repeats per group of five", () => {
    expect(discount([embout(14.95, 11)])).toBe(59.8);
  });
});

describe("computeRuleDiscounts — a whole cart", () => {
  it("applies each offer to its own lines and reports them in the code's order", () => {
    const result = computeRuleDiscounts(ESTETIKA, [
      cire(5),
      line(20, 1, { brandId: "albi" }),
      klyn(2),
      line(30, 1, { brandId: "staleks" }),
    ]);
    expect(result.appliedRules).toEqual([
      { ruleId: "albi", label: "albi", discountAmount: 4.2 },
      { ruleId: "klyn", label: "klyn", discountAmount: 7.79 },
      { ruleId: "cire-5", label: "cire-5", discountAmount: 29.8 },
    ]);
    expect(result.discountAmount).toBe(41.79);
    expect(result.lineDiscounts).toHaveLength(3);
  });

  it("never discounts a line by more than it costs", () => {
    const free = [rule("all", { kind: "PERCENT_OFF", percent: 100, brandIds: ["albi"] })];
    expect(computeRuleDiscounts(free, [line(9.99, 3, { brandId: "albi" })]).discountAmount).toBe(29.97);
  });

  it("ignores empty carts, zero quantities and unknown mechanics", () => {
    expect(computeRuleDiscounts(ESTETIKA, []).discountAmount).toBe(0);
    expect(computeRuleDiscounts(ESTETIKA, [klyn(0)]).discountAmount).toBe(0);
    expect(computeRuleDiscounts([rule("x", { kind: "NOPE", brandIds: ["klyn"] })], [klyn(2)]).discountAmount).toBe(0);
  });
});

describe("allocateOrderDiscount — multi-offer orders", () => {
  const order = {
    discountAmount: 9.9,
    items: [
      { id: "embouts", unitPrice: 4.95, quantity: 5, discountAmount: 9.9 },
      { id: "lime", unitPrice: 12, quantity: 1, discountAmount: 0 },
    ],
  };

  it("keeps each line's own discount instead of prorating it over the order", () => {
    const net = allocateOrderDiscount(order);
    expect(net.get("embouts")).toBe(14.85);
    expect(net.get("lime")).toBe(12);
  });

  it("still prorates a classic code, whose lines carry no discount of their own", () => {
    const classic = { discountAmount: 10, items: order.items.map((item) => ({ ...item, discountAmount: 0 })) };
    const net = allocateOrderDiscount(classic);
    expect(net.get("lime")).toBeLessThan(12);
    expect(Math.round((net.get("embouts") + net.get("lime")) * 100)).toBe(2675);
  });
});

describe("promoCodeSchema — MULTI_RULE", () => {
  const offer = { label: "KLYN : -15 % dès 2", kind: "PERCENT_OFF", percent: 15, minQuantity: 2, brandIds: ["klyn"] };
  const multi = (rules, extra = {}) => promoCodeSchema.safeParse({ code: "ESTETIKA", type: "MULTI_RULE", rules, ...extra });

  it("needs no value, is boutique-only and drops the single-value product filter", () => {
    const parsed = multi([offer], { scopes: ["BOUTIQUE", "WORKSHOP"], productIds: ["p1"] });
    expect(parsed.success).toBe(true);
    expect(parsed.data).toMatchObject({ value: 0, scopes: ["BOUTIQUE"], productIds: [] });
    expect(parsed.data.rules[0]).toMatchObject({ percent: 15, minQuantity: 2, buyQuantity: null, freeQuantity: null, samePriceOnly: false });
  });

  it("refuses a code without offers, an offer without targets or without its numbers", () => {
    expect(multi([]).success).toBe(false);
    expect(multi([{ ...offer, brandIds: [] }]).success).toBe(false);
    expect(multi([{ ...offer, percent: "" }]).success).toBe(false);
    expect(multi([{ label: "Embouts", kind: "BUY_X_GET_Y_FREE", buyQuantity: 3, categoryIds: ["embouts"] }]).success).toBe(false);
  });

  it("keeps only the numbers each mechanic reads", () => {
    const parsed = multi([
      { label: "Embouts", kind: "BUY_X_GET_Y_FREE", buyQuantity: 3, freeQuantity: 2, samePriceOnly: true, percent: 50, categoryIds: ["embouts"] },
    ]);
    expect(parsed.data.rules[0]).toMatchObject({ percent: null, buyQuantity: 3, freeQuantity: 2, samePriceOnly: true, minQuantity: 1 });
  });

  it("still requires a value for a classic code and ignores stray offers on it", () => {
    expect(promoCodeSchema.safeParse({ code: "TEN", type: "PERCENTAGE", value: "" }).success).toBe(false);
    const parsed = promoCodeSchema.safeParse({ code: "TEN", type: "PERCENTAGE", value: 10, rules: [offer] });
    expect(parsed.data.rules).toEqual([]);
  });
});
