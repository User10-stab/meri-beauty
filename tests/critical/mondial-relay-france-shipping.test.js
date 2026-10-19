import { describe, expect, it } from "vitest";
import {
  calculateShippingCost,
  getShippingDetails,
  isValidPickupPostalCode,
  SHIPPING_COUNTRIES,
} from "@/lib/shipping";
import { shippingQuoteRequestSchema } from "@/lib/validations/commerce";
import { relayPointLocation } from "@/lib/mondial-relay";

// France: Mondial Relay "Tarifs professionnels applicables au 1er Janvier
// 2025", Point Relais® HT, screenshotted 19 Oct 2026. Belgium unchanged. A French customer could only
// pick « retrait en boutique » because every piece of shipping was BE-only.
describe("Mondial Relay shipping to Belgium and France", () => {
  it("serves exactly Belgium and France", () => {
    expect(SHIPPING_COUNTRIES).toEqual(["BE", "FR"]);
  });

  it.each([
    [250, 4.51],
    [500, 4.51],
    [501, 4.70],
    [2000, 5.07],
    [3000, 5.26],
    [4000, 5.45],
    [5000, 5.63],
    [7000, 7.06],
    [10000, 8.56],
    [15000, 11.95],
    [20000, 13.45],
    [25000, 23.14],
    [30000, 23.14],
  ])("%i g to a French relay point costs %s € HT", (grams, fr) => {
    expect(calculateShippingCost(grams, 10, "FR")).toBe(fr);
  });

  it.each([
    [500, 3.12],
    [1000, 3.22],
    [2000, 3.42],
    [4000, 3.82],
    [10000, 5.43],
    [25000, 14.77],
    [30000, 19.99],
  ])("Belgian prices are unchanged: %i g costs %s € HT", (grams, be) => {
    expect(calculateShippingCost(grams, 10, "BE")).toBe(be);
  });

  it("defaults to Belgium for callers that pass no country", () => {
    expect(calculateShippingCost(400, 10)).toBe(3.12);
  });

  it("keeps free shipping from 150 € and the >30 kg quote for France too", () => {
    expect(calculateShippingCost(1000, 150, "FR")).toBe(0);
    expect(calculateShippingCost(30001, 10, "FR")).toBe("QUOTE_REQUIRED");
    expect(getShippingDetails(1000, 10, "FR").appliedTier).toEqual({ maxWeightKg: 1, price: 4.70 });
  });

  it("refuses a country it has no price for, rather than charging the Belgian one", () => {
    expect(() => calculateShippingCost(500, 10, "DE")).toThrow(/DE/);
  });

  it("checks the relay point postal code against its own country", () => {
    expect(isValidPickupPostalCode("1000", "BE")).toBe(true);
    expect(isValidPickupPostalCode("59000", "FR")).toBe(true);
    expect(isValidPickupPostalCode("59000", "BE")).toBe(false);
    expect(isValidPickupPostalCode("1000", "FR")).toBe(false);
    expect(isValidPickupPostalCode("1000", "DE")).toBe(false);
  });
});

describe("checkout validation accepts a French relay point", () => {
  const base = { fullName: "Camille Martin", email: "camille@example.fr", phone: "+33612345678" };
  const point = { id: "066974", name: "Tabac du centre", address: "1 rue de Paris", city: "Lille" };

  it("accepts a 5-digit French postal code with countryCode FR", () => {
    const parsed = shippingQuoteRequestSchema.safeParse({ ...base, pickupPoint: { ...point, postalCode: "59000", countryCode: "fr" } });
    expect(parsed.success).toBe(true);
    expect(parsed.data.pickupPoint.countryCode).toBe("FR");
  });

  it("rejects a French postal code on a Belgian point, and an unserved country", () => {
    expect(shippingQuoteRequestSchema.safeParse({ ...base, pickupPoint: { ...point, postalCode: "59000" } }).success).toBe(false);
    expect(shippingQuoteRequestSchema.safeParse({ ...base, pickupPoint: { ...point, postalCode: "10115", countryCode: "DE" } }).success).toBe(false);
  });
});

describe("relayPointLocation", () => {
  it("prefixes the relay point number with its country", () => {
    expect(relayPointLocation("FR", "066974")).toBe("FR-066974");
    expect(relayPointLocation("BE", "041021")).toBe("BE-041021");
  });

  it("leaves an already-prefixed id alone", () => {
    expect(relayPointLocation("FR", "FR-066974")).toBe("FR-066974");
  });
});
