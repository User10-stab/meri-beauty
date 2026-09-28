import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { promoCodeSchema, updatePromoCodeSchema } from "@/lib/validations/promo-codes";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8");

describe("promo-code limits and free checkout contracts", () => {
  test("public promo validation consumes the shared rate limiter", () => {
    const action = source("actions/promo-codes.js");

    expect(action).toContain('consumeSharedRateLimit("promo-validate"');
    expect(action).toContain("hashRateLimitValue");
    expect(action).toContain("getClientIp");
    expect(action).not.toContain("`${code}:${ip}`");
  });

  test("admin input accepts optional expiry/cap and rejects invalid caps", () => {
    const valid = promoCodeSchema.safeParse({
      code: "FREE100",
      type: "PERCENTAGE",
      value: 100,
      expiresAt: "2026-12-31T23:59",
      maxUses: "25",
    });
    expect(valid.success).toBe(true);
    expect(valid.data.maxUses).toBe(25);
    expect(valid.data.expiresAt).toBeInstanceOf(Date);

    expect(promoCodeSchema.safeParse({ code: "FREE100", type: "PERCENTAGE", value: 100, maxUses: "0" }).success).toBe(false);
    expect(updatePromoCodeSchema.safeParse({ id: "promo-1", code: "FREE100", type: "PERCENTAGE", value: 100, maxUses: "1.5" }).success).toBe(false);
  });

  test("every checkout bypasses Stripe safely when a promo makes it free", () => {
    const order = source("actions/boutique/orders.js");
    const workshop = source("actions/workshops/create-workshop-reservation.js");
    const formation = source("actions/formations/create-formation-reservation.js");

    expect(order).toContain("free_order_");
    expect(order).toContain("await fulfillOrderPayment(syntheticSession)");
    expect(workshop).toContain("free_workshop_");
    expect(workshop).toContain("await confirmWorkshopReservationPayment(syntheticSession)");
    expect(formation).toContain("free_formation_");
    expect(formation).toContain("await confirmFormationReservationPayment(syntheticSession)");
  });

  test("promo availability is enforced at validation and atomically claimed in all checkout flows", () => {
    const resolver = source("lib/promo-codes.js");
    expect(resolver).toContain("promo.expiresAt");
    expect(resolver).toContain("promo.usedCount >= promo.maxUses");
    expect(resolver).toContain("usedCount: { lt: maxUses }");
    expect(resolver).toContain('throw new Error("PROMO_EXHAUSTED")');
    expect(resolver).toContain('throw new Error("PROMO_CUSTOMER_LIMIT")');
    // The per-customer count must be serialised per code, or two parallel
    // checkouts by the same person both pass.
    expect(resolver).toContain('SELECT id FROM "PromoCode" WHERE id = ${promoCodeId} FOR UPDATE');

    for (const [path, scope] of [
      ["actions/boutique/orders.js", "BOUTIQUE"],
      ["actions/workshops/create-workshop-reservation.js", "WORKSHOP"],
      ["actions/formations/create-formation-reservation.js", "FORMATION"],
      ["actions/reservation/create-reservation.js", "APPOINTMENT"],
      ["actions/payment/createCheckoutSession.js", "APPOINTMENT"],
    ]) {
      const checkout = source(path);
      expect(checkout, path).toContain(`scope: "${scope}"`);
      expect(checkout, path).toContain("await claimPromoCodeUse(tx, {");
      expect(checkout, path).toContain("promoClaimErrorMessage(");
    }
  });

  test("the claim happens before the row carrying the code is created", () => {
    const order = source("actions/boutique/orders.js");
    expect(order.indexOf("await claimPromoCodeUse(tx")).toBeLessThan(order.indexOf("const created = await tx.order.create"));
    const checkout = source("actions/payment/createCheckoutSession.js");
    expect(checkout.indexOf("await claimPromoCodeUse(tx")).toBeLessThan(checkout.indexOf("const payment = await tx.payment.create"));
    // The appointment checkout prices before the customer exists, so it
    // must re-check the customer rules once the account is resolved.
    expect(checkout).toContain("skipCustomerChecks: true");
    expect(checkout).toContain("checkPromoCustomerEligibility(promoCodeId, customerUser.id)");
  });

  test("admin input: scopes, targets, customers and per-customer cap", () => {
    const base = { code: "JULIE15", type: "PERCENTAGE", value: 15 };

    const defaults = promoCodeSchema.parse(base);
    expect(defaults.scopes).toEqual(["BOUTIQUE", "APPOINTMENT", "WORKSHOP", "FORMATION"]);
    expect(defaults.productIds).toEqual([]);
    expect(defaults.maxUsesPerCustomer).toBeNull();
    expect(defaults.expiresAt).toBeNull();

    expect(promoCodeSchema.safeParse({ ...base, scopes: [] }).success).toBe(false);
    expect(promoCodeSchema.safeParse({ ...base, scopes: ["NOPE"] }).success).toBe(false);
    expect(promoCodeSchema.safeParse({ ...base, maxUsesPerCustomer: "0" }).success).toBe(false);
    expect(promoCodeSchema.safeParse({ ...base, maxUses: 2, maxUsesPerCustomer: 3 }).success).toBe(false);

    const scoped = promoCodeSchema.parse({
      ...base,
      scopes: ["APPOINTMENT"],
      productIds: ["p1"],
      serviceIds: ["s1", "s1"],
      customerIds: ["u1"],
      maxUsesPerCustomer: "1",
    });
    // A product filter outside the boutique scope is dropped, not kept hidden.
    expect(scoped.productIds).toEqual([]);
    expect(scoped.serviceIds).toEqual(["s1"]);
    expect(scoped.customerIds).toEqual(["u1"]);
    expect(scoped.maxUsesPerCustomer).toBe(1);
  });

  test("per-customer usage ignores released sales", () => {
    const resolver = source("lib/promo-codes.js");
    expect(resolver).toContain('status: { notIn: ["CANCELLED", "EXPIRED", "SETTLED_AT_COUNTER"] }');
    expect(resolver).toContain("{ holdExpiresAt: { gte: now } }");
    // A rendez-vous is freed by its own status only — a FAILED online payment
    // can still be paid through the retry link, so it keeps its use (same
    // rule as releaseAppointmentPromoUse for the global cap).
    expect(resolver).toContain('appointment: { is: { userId: customerId, status: { notIn: ["CANCELLED", "REJECTED"] } } }');
    expect(resolver).not.toContain('status: { notIn: ["FAILED", "REFUNDED"] }');
  });
});
