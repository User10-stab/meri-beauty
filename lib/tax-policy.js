import { getVatCountryCode, isValidVatFormat, normalizeVatNumber } from "@/lib/vat-validation";

export const BELGIUM_VAT_RATE = 21;

// The single source of truth for the reverse-charge wording. It used to be
// spelled two different ways — this longer form here, and a hardcoded
// "Autoliquidation Art 21 § 2 du code TVA belge" in the PDF — so an invoice
// and its own credit note could print different legal mentions. Normalised on
// the shorter form at the client's request (2026-08-28).
export const REVERSE_CHARGE_NOTE = "Autoliquidation Art 21 § 2 du code TVA belge";

// A legal invoice note follows the transaction itself, not merely the fact
// that the customer has a company account. Domestic Belgian B2B sales remain
// taxed, so this note is only ever *stored* on a genuine intra-Community
// supply — see resolveForeignEuVatPolicy below, which is unchanged. What the
// PDF chooses to *print* is a separate decision, made in InvoiceDocument.jsx.
export const VAT_LEGAL_NOTES = Object.freeze({
  FOREIGN_EU_B2B_ZERO: REVERSE_CHARGE_NOTE,
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
 * Applies VAT to a genuinely net amount, such as the carrier's HT tariff or
 * an ad-hoc POS service line. Catalogue prices must use
 * repriceTtcCataloguePrice() instead because they are stored TTC.
 */
export function applyVatRate(netPrice, vatRate) {
  return roundMoney(Number(netPrice) * (1 + Number(vatRate) / 100));
}

/** Extracts the unrounded HT base from a Belgian 21% TTC catalogue price. */
export function cataloguePriceExclVat(ttcPrice) {
  return Number(ttcPrice) / (1 + BELGIUM_VAT_RATE / 100);
}

/**
 * Reprices a catalogue amount stored TTC at the rate applicable to the buyer.
 * A normal Belgian sale returns the stored amount unchanged; a validated
 * foreign-EU reverse-charge sale returns its HT base (0% VAT).
 */
export function repriceTtcCataloguePrice(ttcPrice, targetVatRate) {
  return applyVatRate(cataloguePriceExclVat(ttcPrice), targetVatRate);
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

export function hasInvoiceableVatIdentity(customer, now = new Date()) {
  return hasReusableVatValidation(customer, customer?.vatNumber, now);
}

/**
 * Belgium's structured e-invoicing mandate (effective 2026) requires a B2B
 * invoice to a Belgian VAT-registered company to be delivered over Peppol,
 * not as an ad-hoc PDF e-mail. The invoice itself must still be issued and
 * numbered for VAT purposes — only its delivery to the customer is
 * restricted, so a counter sale still creates it but sends the customer a
 * plain receipt instead, and staff transmit the real invoice over Peppol
 * afterward (see actions/invoices/send-invoice-billit.js).
 */
export function isPeppolMandatoryCustomer(customer) {
  if (!hasInvoiceableVatIdentity(customer)) return false;
  return getVatCountryCode(customer.vatNumber) === "BE";
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
