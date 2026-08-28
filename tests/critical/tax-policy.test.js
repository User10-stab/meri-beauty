import { describe, expect, it } from "vitest";
import {
  calculateVatTotals,
  cataloguePriceExclVat,
  hasReusableVatValidation,
  applyVatRate,
  repriceTtcCataloguePrice,
  resolveForeignEuVatPolicy,
  resolveGoodsVatPolicy,
  resolveServiceVatPolicy,
  VAT_LEGAL_NOTES,
} from "@/lib/tax-policy";

const now = new Date("2026-08-24T12:00:00.000Z");
const frenchCompany = {
  isCompany: true,
  vatNumber: "FR40303265045",
  vatValidatedAt: new Date("2026-08-20T12:00:00.000Z"),
};

describe("customer VAT policy", () => {
  it("reuses a VIES proof for the same VAT number for 90 days", () => {
    expect(hasReusableVatValidation(frenchCompany, "FR 40 303 265 045", now)).toBe(true);
    expect(hasReusableVatValidation(frenchCompany, "DE136695976", now)).toBe(false);
    expect(hasReusableVatValidation(
      { ...frenchCompany, vatValidatedAt: new Date("2026-05-25T11:59:59.000Z") },
      frenchCompany.vatNumber,
      now
    )).toBe(false);
  });

  it("applies 0% to a recently VIES-validated company from another EU country", () => {
    const policy = resolveForeignEuVatPolicy({ customer: frenchCompany, now });

    expect(policy).toMatchObject({
      taxCountryCode: "FR",
      vatTreatment: "EU_REVERSE_CHARGE",
      vatRate: 0,
      customerVatNumber: frenchCompany.vatNumber,
    });
    expect(policy.taxNote).toBe(VAT_LEGAL_NOTES.FOREIGN_EU_B2B_ZERO);
    expect(policy.taxNote).not.toMatch(/test|non fiscal/i);
  });

  it("uses the same 0% rule for products, pickup, appointments, formations and workshops", () => {
    expect(resolveGoodsVatPolicy({
      fulfilmentMode: "PICKUP_ON_SITE",
      destinationCountry: "BE",
      customer: frenchCompany,
      now,
    }).vatRate).toBe(0);
    expect(resolveServiceVatPolicy({ customer: frenchCompany, now }).vatRate).toBe(0);
  });

  it("keeps 21% for a VIES-validated Belgian company", () => {
    const belgianCompany = {
      isCompany: true,
      vatNumber: "BE0123456749",
      vatValidatedAt: new Date("2026-08-20T12:00:00.000Z"),
    };

    expect(resolveGoodsVatPolicy({ customer: belgianCompany, now })).toMatchObject({
      taxCountryCode: "BE",
      vatTreatment: "DOMESTIC",
      vatRate: 21,
    });
    expect(resolveServiceVatPolicy({ customer: belgianCompany, now }).vatRate).toBe(21);
  });

  it("keeps 21% for customers outside the EU", () => {
    const swissCustomer = {
      isCompany: true,
      vatNumber: "CHE123456789",
      vatValidatedAt: new Date("2026-08-20T12:00:00.000Z"),
    };

    expect(resolveGoodsVatPolicy({
      fulfilmentMode: "SHIPPING_PREPAID",
      destinationCountry: "CH",
      customer: swissCustomer,
      now,
    }).vatRate).toBe(21);
    expect(resolveServiceVatPolicy({ customer: swissCustomer, now }).vatRate).toBe(21);
  });

  it.each([
    ["missing VIES proof", { ...frenchCompany, vatValidatedAt: null }],
    ["stale VIES proof", { ...frenchCompany, vatValidatedAt: new Date("2025-01-01T00:00:00.000Z") }],
    ["invalid VAT format", { ...frenchCompany, vatNumber: "FRINVALID" }],
    ["non-company account", { ...frenchCompany, isCompany: false }],
    ["no VAT number", { isCompany: true, vatNumber: null, vatValidatedAt: null }],
  ])("keeps 21% with %s", (_label, customer) => {
    expect(resolveGoodsVatPolicy({ customer, now }).vatRate).toBe(21);
    expect(resolveServiceVatPolicy({ customer, now }).vatRate).toBe(21);
  });
});

describe("VAT amount snapshots", () => {
  it("splits a Belgian VAT-inclusive total", () => {
    expect(calculateVatTotals(121, 21)).toEqual({ totalInclVat: 121, totalExclVat: 100, vatAmount: 21 });
  });

  it("keeps a stored TTC catalogue price unchanged for a Belgian sale", () => {
    expect(cataloguePriceExclVat(121)).toBe(100);
    expect(repriceTtcCataloguePrice(121, 21)).toBe(121);
    expect(repriceTtcCataloguePrice(121, 0)).toBe(100);
  });

  it("still applies VAT normally to genuinely HT amounts", () => {
    expect(applyVatRate(100, 0)).toBe(100);
    expect(applyVatRate(100, 21)).toBe(121);
    expect(calculateVatTotals(100, 0)).toEqual({ totalInclVat: 100, totalExclVat: 100, vatAmount: 0 });
  });
});
