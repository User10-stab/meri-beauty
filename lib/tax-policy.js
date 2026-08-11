import { getVatCountryCode, isValidVatFormat, viesPrefixForCountry } from "@/lib/vat-validation";

export const BELGIUM_VAT_RATE = 21;

// A legal invoice note follows the transaction itself, not merely the fact
// that the customer has a company account. Domestic Belgian B2B sales remain
// taxed and must never be labelled as reverse-charged.
export const VAT_LEGAL_NOTES = Object.freeze({
  INTRA_COMMUNITY_GOODS:
    "Exonération de TVA — livraison intracommunautaire — article 39bis du Code TVA belge et article 138 de la directive 2006/112/CE.",
  CROSS_BORDER_B2B_SERVICES:
    "Autoliquidation — article 21, § 2 du Code TVA belge et article 196 de la directive 2006/112/CE.",
  OSS_DISTANCE_SALE:
    "TVA du pays de destination déclarée via le régime OSS.",
  EXPORT:
    "Exportation hors UE exonérée de TVA belge — preuve douanière conservée.",
});

// Standard rates for ordinary retail goods. Source: European Commission,
// checked 2026-08-11. Product-specific reduced rates are deliberately not
// inferred here; every catalogue item currently uses the standard rate.
export const EU_STANDARD_VAT_RATES = Object.freeze({
  AT: 20, BE: 21, BG: 20, CY: 19, CZ: 21, DE: 19, DK: 25,
  EE: 24, EL: 24, ES: 21, FI: 25.5, FR: 20, HR: 25, HU: 27,
  IE: 23, IT: 22, LT: 21, LU: 17, LV: 21, MT: 18, NL: 21,
  PL: 23, PT: 23, RO: 21, SE: 25, SI: 22, SK: 23,
});

const VAT_VALIDATION_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;

export function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

export function isOssEnabled() {
  return process.env.VAT_OSS_ENABLED === "true";
}

export function calculateVatTotals(totalInclVat, vatRate) {
  const total = roundMoney(totalInclVat);
  const rate = Number(vatRate);
  const totalExclVat = rate === 0 ? total : roundMoney(total / (1 + rate / 100));
  return { totalInclVat: total, totalExclVat, vatAmount: roundMoney(total - totalExclVat) };
}

/** Converts a Belgian TTC catalogue price to the TTC price at another rate. */
export function repriceBelgianGross(grossPrice, targetVatRate) {
  const net = Number(grossPrice) / (1 + BELGIUM_VAT_RATE / 100);
  return roundMoney(net * (1 + Number(targetVatRate) / 100));
}

function hasRecentVatValidation(customer, now) {
  if (!customer?.vatValidatedAt) return false;
  const checkedAt = new Date(customer.vatValidatedAt).getTime();
  return Number.isFinite(checkedAt) && now.getTime() - checkedAt <= VAT_VALIDATION_MAX_AGE_MS;
}

/**
 * Determines VAT only for physical boutique goods. Appointments, workshops,
 * formations and events have separate place-of-supply rules and must not call
 * this function.
 */
export function resolveGoodsVatPolicy({
  fulfilmentMode,
  destinationCountry = "BE",
  customer,
  ossEnabled = isOssEnabled(),
  exportConfirmed = false,
  now = new Date(),
}) {
  const destination = String(destinationCountry || "BE").trim().toUpperCase();

  // A pickup/POS transaction takes place in Belgium. A foreign address alone
  // never turns a counter sale into an export or intra-Community supply.
  if (fulfilmentMode !== "SHIPPING_PREPAID" || destination === "BE") {
    return {
      taxCountryCode: "BE",
      vatTreatment: "DOMESTIC",
      vatRate: BELGIUM_VAT_RATE,
      customerVatNumber: customer?.isCompany ? customer.vatNumber ?? null : null,
      taxNote: null,
    };
  }

  const destinationViesPrefix = viesPrefixForCountry(destination);
  if (destinationViesPrefix) {
    const vatNumber = customer?.vatNumber ?? null;
    const canReverseCharge = Boolean(
      customer?.isCompany &&
      vatNumber &&
      isValidVatFormat(vatNumber) &&
      getVatCountryCode(vatNumber) === destinationViesPrefix &&
      hasRecentVatValidation(customer, now)
    );

    if (canReverseCharge) {
      return {
        taxCountryCode: destination,
        vatTreatment: "EU_REVERSE_CHARGE",
        vatRate: 0,
        customerVatNumber: vatNumber,
        taxNote: VAT_LEGAL_NOTES.INTRA_COMMUNITY_GOODS,
      };
    }

    const destinationRate = EU_STANDARD_VAT_RATES[destinationViesPrefix];
    if (ossEnabled && destinationRate == null) {
      throw new Error("VAT_RATE_NOT_CONFIGURED");
    }
    return {
      taxCountryCode: ossEnabled ? destination : "BE",
      vatTreatment: ossEnabled ? "EU_DISTANCE_SALE" : "DOMESTIC",
      vatRate: ossEnabled ? destinationRate : BELGIUM_VAT_RATE,
      customerVatNumber: customer?.isCompany ? vatNumber : null,
      taxNote: ossEnabled ? VAT_LEGAL_NOTES.OSS_DISTANCE_SALE : null,
    };
  }

  if (!exportConfirmed) throw new Error("EXPORT_REQUIRES_MANUAL_REVIEW");
  return {
    taxCountryCode: destination,
    vatTreatment: "EXPORT",
    vatRate: 0,
    customerVatNumber: customer?.isCompany ? customer.vatNumber ?? null : null,
    taxNote: VAT_LEGAL_NOTES.EXPORT,
  };
}
