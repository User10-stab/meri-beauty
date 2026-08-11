import { describe, expect, it } from "vitest";
import {
  calculateVatTotals,
  EU_STANDARD_VAT_RATES,
  repriceBelgianGross,
  resolveGoodsVatPolicy,
  VAT_LEGAL_NOTES,
} from "@/lib/tax-policy";

const now = new Date("2026-08-11T12:00:00.000Z");
const frenchCompany = {
  isCompany: true,
  vatNumber: "FR40303265045",
  vatValidatedAt: new Date("2026-08-01T12:00:00.000Z"),
};

describe("physical goods VAT policy", () => {
  it("uses the corrected country dataset as the source of EU standard rates", () => {
    expect(EU_STANDARD_VAT_RATES.EE).toBe(24);
    expect(EU_STANDARD_VAT_RATES.RO).toBe(21);
    expect(EU_STANDARD_VAT_RATES.FR).toBe(20);
  });

  it("always taxes POS and pickup transactions in Belgium", () => {
    const policy = resolveGoodsVatPolicy({
      fulfilmentMode: "PICKUP_ON_SITE",
      destinationCountry: "FR",
      customer: frenchCompany,
      ossEnabled: true,
      now,
    });
    expect(policy).toMatchObject({ taxCountryCode: "BE", vatTreatment: "DOMESTIC", vatRate: 21 });
    expect(policy.taxNote).toBeNull();
  });

  it("keeps Belgian VAT for EU B2C sales while OSS is disabled", () => {
    const policy = resolveGoodsVatPolicy({
      fulfilmentMode: "SHIPPING_PREPAID",
      destinationCountry: "FR",
      customer: { isCompany: false },
      ossEnabled: false,
      now,
    });
    expect(policy).toMatchObject({ taxCountryCode: "BE", vatTreatment: "DOMESTIC", vatRate: 21 });
  });

  it("uses destination VAT for EU B2C sales when OSS is enabled", () => {
    const policy = resolveGoodsVatPolicy({
      fulfilmentMode: "SHIPPING_PREPAID",
      destinationCountry: "FR",
      customer: { isCompany: false },
      ossEnabled: true,
      now,
    });
    expect(policy).toMatchObject({ taxCountryCode: "FR", vatTreatment: "EU_DISTANCE_SALE", vatRate: 20 });
    expect(repriceBelgianGross(121, policy.vatRate)).toBe(120);
  });

  it("applies 0% only to a recently VIES-validated EU company in the delivery country", () => {
    const policy = resolveGoodsVatPolicy({
      fulfilmentMode: "SHIPPING_PREPAID",
      destinationCountry: "FR",
      customer: frenchCompany,
      ossEnabled: false,
      now,
    });
    expect(policy).toMatchObject({
      taxCountryCode: "FR",
      vatTreatment: "EU_REVERSE_CHARGE",
      vatRate: 0,
      customerVatNumber: frenchCompany.vatNumber,
    });
    expect(policy.taxNote).toBe(VAT_LEGAL_NOTES.INTRA_COMMUNITY_GOODS);
    expect(repriceBelgianGross(121, policy.vatRate)).toBe(100);
  });

  it("keeps the legally distinct B2B service reverse-charge wording available to invoice callers", () => {
    expect(VAT_LEGAL_NOTES.CROSS_BORDER_B2B_SERVICES).toBe(
      "Autoliquidation — article 21, § 2 du Code TVA belge et article 196 de la directive 2006/112/CE."
    );
  });

  it("does not grant 0% when VIES confirmation is stale", () => {
    const policy = resolveGoodsVatPolicy({
      fulfilmentMode: "SHIPPING_PREPAID",
      destinationCountry: "FR",
      customer: { ...frenchCompany, vatValidatedAt: new Date("2025-01-01T00:00:00.000Z") },
      ossEnabled: false,
      now,
    });
    expect(policy).toMatchObject({ vatTreatment: "DOMESTIC", vatRate: 21 });
  });

  it("blocks a non-EU zero-rate until export evidence is confirmed", () => {
    expect(() => resolveGoodsVatPolicy({
      fulfilmentMode: "SHIPPING_PREPAID",
      destinationCountry: "CH",
      customer: { isCompany: false },
      exportConfirmed: false,
      now,
    })).toThrow("EXPORT_REQUIRES_MANUAL_REVIEW");

    const policy = resolveGoodsVatPolicy({
      fulfilmentMode: "SHIPPING_PREPAID",
      destinationCountry: "CH",
      customer: { isCompany: false },
      exportConfirmed: true,
      now,
    });
    expect(policy).toMatchObject({ taxCountryCode: "CH", vatTreatment: "EXPORT", vatRate: 0 });
  });
});

describe("VAT amount snapshots", () => {
  it("splits a Belgian VAT-inclusive total", () => {
    expect(calculateVatTotals(121, 21)).toEqual({ totalInclVat: 121, totalExclVat: 100, vatAmount: 21 });
  });

  it("keeps a reverse-charge total fully exclusive of VAT", () => {
    expect(calculateVatTotals(100, 0)).toEqual({ totalInclVat: 100, totalExclVat: 100, vatAmount: 0 });
  });
});
