import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { promoCodeSchema, updatePromoCodeSchema } from "@/lib/validations/promo-codes";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8");

describe("promo-code limits and free checkout contracts", () => {
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

    for (const path of [
      "actions/boutique/orders.js",
      "actions/workshops/create-workshop-reservation.js",
      "actions/formations/create-formation-reservation.js",
    ]) {
      const checkout = source(path);
      expect(checkout).toContain("usedCount: { lt: promoMaxUses }");
      expect(checkout).toContain('throw new Error("PROMO_EXHAUSTED")');
    }
  });
});
