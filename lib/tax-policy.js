import { getVatCountryCode, isValidVatFormat, normalizeVatNumber } from "@/lib/vat-validation";

export const BELGIUM_VAT_RATE = 21;

// A legal invoice note follows the transaction itself, not merely the fact
// that the customer has a company account. Domestic Belgian B2B sales remain
// taxed and must never be labelled as reverse-charged.
export const VAT_LEGAL_NOTES = Object.freeze({
  FOREIGN_EU_B2B_ZERO:
    "Autoliquidation — article 21, § 2 du Code TVA belge et article 196 de la directive 2006/112/CE.",
});

const EU_MEMBER_STATE_CODES = new Set([
  "AT", "BE", "BG", "CY", "CZ", "DE", "DK", "EE", "ES", "FI", "FR",
  "GR", "HR", "HU", "IE", "IT", "LT", "LU", "LV", "MT", "NL", "PL",
  "PT", "RO", "SE", "SI", "SK",
]);

const VAT_VALIDATION_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;

export function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

export function calculateVatTotals(totalInclVat, vatRate) {
  const total = roundMoney(totalInclVat);
  const rate = Number(vatRate);
  const totalExclVat = rate === 0 ? total : roundMoney(total / (1 + rate / 100));
  return { totalInclVat: total, totalExclVat, vatAmount: roundMoney(total - totalExclVat) };
}

/**
 * Applies a VAT rate to a catalogue price.
 *
 * Catalogue prices — ProductVariant.price/comparePrice, Activity.price,
 * Formation.price, the shipping tiers — are stored NET (hors TVA). The tax is
 * added here, at the single point where the applicable rate is known: 21 % for
 * a Belgian sale, 0 % for a validated intra-Community B2B supply.
 *
 * This used to be applyVatRate, which divided by 1.21 first because the
 * catalogue stored TTC prices instead. That storage was ambiguous — nothing
 * said so in the admin form, so a net price typed there was silently sold 21 %
 * too cheap — and it made the "unit price excluding VAT" that art. 226(8)
 * requires on an invoice a derived, rounded figure rather than the real one.
 * Every call site already passed a catalogue price and a target rate, so the
 * signature is unchanged; only the stored basis and this body moved.
 */
export function applyVatRate(netPrice, vatRate) {
  return roundMoney(Number(netPrice) * (1 + Number(vatRate) / 100));
}

export function hasRecentVatValidation(customer, now = new Date()) {
  if (!customer?.vatValidatedAt) return false;
  const checkedAt = new Date(customer.vatValidatedAt).getTime();
  const age = now.getTime() - checkedAt;
  return Number.isFinite(checkedAt) && age >= 0 && age <= VAT_VALIDATION_MAX_AGE_MS;
}

/** A saved VIES proof can be reused only for the exact same VAT number. */
export function hasReusableVatValidation(customer, vatNumber = customer?.vatNumber, now = new Date()) {
  if (!customer?.isCompany || !customer?.vatNumber || !vatNumber) return false;
  const savedVatNumber = normalizeVatNumber(customer.vatNumber);
  const requestedVatNumber = normalizeVatNumber(vatNumber);
  return Boolean(
    isValidVatFormat(savedVatNumber) &&
    savedVatNumber === requestedVatNumber &&
    hasRecentVatValidation(customer, now)
  );
}

export function resolveForeignEuVatPolicy({ customer, now = new Date() } = {}) {
  const vatNumber = customer?.vatNumber ?? null;
  const vatCountry = vatNumber ? getVatCountryCode(vatNumber) : null;
  const isValidatedForeignEuCompany = Boolean(
    customer?.isCompany &&
    vatNumber &&
    isValidVatFormat(vatNumber) &&
    vatCountry &&
    vatCountry !== "BE" &&
    EU_MEMBER_STATE_CODES.has(vatCountry === "EL" ? "GR" : vatCountry) &&
    hasReusableVatValidation(customer, vatNumber, now)
  );

  if (!isValidatedForeignEuCompany) return null;

  return {
    taxCountryCode: vatCountry,
    vatTreatment: "EU_REVERSE_CHARGE",
    vatRate: 0,
    customerVatNumber: vatNumber,
    taxNote: VAT_LEGAL_NOTES.FOREIGN_EU_B2B_ZERO,
  };
}

/**
 * Products use the same account rule as every other purchase type.
 */
export function resolveGoodsVatPolicy({
  customer,
  now = new Date(),
}) {
  const foreignEuPolicy = resolveForeignEuVatPolicy({ customer, now });
  if (foreignEuPolicy) return foreignEuPolicy;

  return {
    taxCountryCode: "BE",
    vatTreatment: "DOMESTIC",
    vatRate: BELGIUM_VAT_RATE,
    customerVatNumber: customer?.isCompany ? customer.vatNumber ?? null : null,
    taxNote: null,
  };
}

/**
 * The same customer rule applies to appointments, workshops and formations.
 */
export function resolveServiceVatPolicy({ customer, now = new Date() } = {}) {
  const foreignEuPolicy = resolveForeignEuVatPolicy({ customer, now });
  if (foreignEuPolicy) return foreignEuPolicy;

  return {
    taxCountryCode: "BE",
    vatTreatment: "DOMESTIC",
    vatRate: BELGIUM_VAT_RATE,
    customerVatNumber: customer?.isCompany ? customer?.vatNumber ?? null : null,
    taxNote: null,
  };
}
