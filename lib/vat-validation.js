/**
 * EU VAT number validation — two tiers:
 *  1. `isValidVatFormat` — instant, offline format/checksum check. Safe to
 *     run synchronously inside a Zod schema on every save/submit.
 *  2. `verifyVatWithVies` — live lookup against the EU's VIES registry,
 *     confirming the number is actually active and returning the registered
 *     company name. Network-dependent (VIES is a free government service
 *     that's known to be occasionally slow or unavailable), so callers must
 *     treat a failed/unreachable lookup as "couldn't verify right now", not
 *     "invalid" — never block a save purely because VIES timed out.
 */

const VIES_ENDPOINT = "https://ec.europa.eu/taxation_customs/vies/services/checkVatService";

// Per-country format, keyed by the 2-letter prefix (EL for Greece, per the
// official VIES country-code quirk). Belgium gets a real checksum below;
// every other country is format-only — good enough to reject typos/garbage
// without pretending to replicate each country's exact validation rules.
const VAT_FORMATS = {
  AT: /^U\d{8}$/,
  BE: /^[01]\d{9}$/,
  BG: /^\d{9,10}$/,
  CY: /^\d{8}[A-Z]$/,
  CZ: /^\d{8,10}$/,
  DE: /^\d{9}$/,
  DK: /^\d{8}$/,
  EE: /^\d{9}$/,
  EL: /^\d{9}$/,
  ES: /^[A-Z0-9]\d{7}[A-Z0-9]$/,
  FI: /^\d{8}$/,
  FR: /^[A-Z0-9]{2}\d{9}$/,
  HR: /^\d{11}$/,
  HU: /^\d{8}$/,
  IE: /^\d{7}[A-Z]{1,2}$|^\d[A-Z]\d{5}[A-Z]$/,
  IT: /^\d{11}$/,
  LT: /^(\d{9}|\d{12})$/,
  LU: /^\d{8}$/,
  LV: /^\d{11}$/,
  MT: /^\d{8}$/,
  NL: /^\d{9}B\d{2}$/,
  PL: /^\d{10}$/,
  PT: /^\d{9}$/,
  RO: /^\d{2,10}$/,
  SE: /^\d{12}$/,
  SI: /^\d{8}$/,
  SK: /^\d{10}$/,
};

/**
 * Strips spaces/dots/dashes and uppercases, e.g. "BE 0751.854.027" → "BE0751854027".
 */
function normalizeVat(raw) {
  return String(raw ?? "").replace(/[\s.\-]/g, "").toUpperCase();
}

/**
 * Belgian checksum: the last 2 digits must equal 97 minus (the first 8
 * digits mod 97). Per FPS Finance's published rule for the modern format
 * (all Belgian VAT numbers have started with a leading 0 since 2007).
 */
function isValidBelgianChecksum(digits) {
  const base = parseInt(digits.slice(0, 8), 10);
  const check = parseInt(digits.slice(8, 10), 10);
  return 97 - (base % 97) === check;
}

/**
 * Splits a normalized VAT number into { countryCode, digits }, or null if
 * it doesn't even look like "XX" + body.
 */
function splitVat(normalized) {
  const match = normalized.match(/^([A-Z]{2})([A-Z0-9]+)$/);
  if (!match) return null;
  return { countryCode: match[1], body: match[2] };
}

/**
 * Offline format (+ checksum for Belgium) validation. Use this as the hard
 * gate on every form that collects a VAT number — no network call, so it's
 * safe to run on every keystroke/submit.
 *
 * @param {string} raw
 * @returns {boolean}
 */
export function isValidVatFormat(raw) {
  const normalized = normalizeVat(raw);
  const split = splitVat(normalized);
  if (!split) return false;

  const pattern = VAT_FORMATS[split.countryCode];
  if (!pattern || !pattern.test(split.body)) return false;

  if (split.countryCode === "BE") {
    return isValidBelgianChecksum(split.body);
  }
  return true;
}

function escapeXml(value) {
  return String(value ?? "").replace(/[<>&'"]/g, (c) => ({
    "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;",
  }[c]));
}

/**
 * Live lookup against the EU VIES registry — confirms the number is
 * actually registered and active, and returns the registered company
 * name/address when available.
 *
 * VIES is a free EU government service with no auth and no SLA — it's
 * known to go down or time out, especially outside business hours or
 * during member-state maintenance windows. A failed/unreachable call means
 * "couldn't verify right now", never "the number is invalid" — callers
 * should surface `success: false` as a retry-later message, not a
 * validation error.
 *
 * @param {string} raw
 * @returns {Promise<{ success: boolean, valid?: boolean, name?: string, address?: string, message?: string }>}
 */
export async function verifyVatWithVies(raw) {
  const normalized = normalizeVat(raw);
  const split = splitVat(normalized);
  if (!split) {
    return { success: false, message: "Format de numéro de TVA invalide." };
  }

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:urn="urn:ec.europa.eu:taxud:vies:services:checkVat:types">
<soapenv:Header/>
<soapenv:Body>
<urn:checkVat>
<urn:countryCode>${escapeXml(split.countryCode)}</urn:countryCode>
<urn:vatNumber>${escapeXml(split.body)}</urn:vatNumber>
</urn:checkVat>
</soapenv:Body>
</soapenv:Envelope>`;

  let response;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    response = await fetch(VIES_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "text/xml; charset=utf-8" },
      body,
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout));
  } catch (error) {
    console.error("[verifyVatWithVies] network error", error);
    return { success: false, message: "Le service européen de vérification (VIES) est actuellement injoignable. Réessayez plus tard." };
  }

  const text = await response.text();

  if (/<faultstring>/.test(text)) {
    const fault = text.match(/<faultstring>([^<]*)<\/faultstring>/)?.[1] ?? "UNKNOWN";
    console.error("[verifyVatWithVies] SOAP fault", fault);
    if (fault === "INVALID_INPUT") {
      return { success: true, valid: false, message: "Numéro de TVA invalide." };
    }
    return { success: false, message: "Le service VIES est temporairement indisponible pour ce pays. Réessayez plus tard." };
  }

  if (!response.ok) {
    console.error("[verifyVatWithVies] HTTP error", response.status, text.slice(0, 500));
    return { success: false, message: "Impossible de contacter le service VIES." };
  }

  const valid = /<valid>true<\/valid>/.test(text);
  const name = text.match(/<name>([^<]*)<\/name>/)?.[1]?.trim() || null;
  const address = text.match(/<address>([^<]*)<\/address>/)?.[1]?.trim().replace(/\n/g, ", ") || null;

  return { success: true, valid, name: name && name !== "---" ? name : null, address: address && address !== "---" ? address : null };
}
