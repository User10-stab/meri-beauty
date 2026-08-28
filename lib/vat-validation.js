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
const VIES_REST_ENDPOINT = "https://ec.europa.eu/taxation_customs/vies/rest-api/check-vat-number";
const VIES_MAX_ATTEMPTS = 3;
const VIES_RETRY_DELAYS_MS = [250, 750];

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
  // Northern Ireland remains available in VIES for trade in goods. Eligible
  // businesses use XI; ordinary GB numbers are not checked by VIES.
  XI: /^(?:\d{9}|\d{12}|GD\d{3}|HA\d{3})$/,
};

export function viesPrefixForCountry(countryCode) {
  const code = String(countryCode ?? "").trim().toUpperCase();
  const prefix = code === "GR" ? "EL" : code === "GB" ? "XI" : code;
  return VAT_FORMATS[prefix] ? prefix : null;
}

/**
 * Strips spaces/dots/dashes and uppercases, e.g. "BE 0751.854.027" → "BE0751854027".
 */
export function normalizeVatNumber(raw) {
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
  const normalized = normalizeVatNumber(raw);
  const split = splitVat(normalized);
  if (!split) return false;

  const pattern = VAT_FORMATS[split.countryCode];
  if (!pattern || !pattern.test(split.body)) return false;

  if (split.countryCode === "BE") {
    return isValidBelgianChecksum(split.body);
  }
  return true;
}

export function getVatCountryCode(raw) {
  return splitVat(normalizeVatNumber(raw))?.countryCode ?? null;
}

function xmlValue(xml, tag) {
  const expression = new RegExp(
    `<(?:(?:[A-Za-z_][\\w.-]*):)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:(?:[A-Za-z_][\\w.-]*):)?${tag}>`,
    "i"
  );
  const match = xml.match(expression);
  if (!match) return null;
  return match[1]
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();
}

/** Parses both unprefixed and namespace-prefixed SOAP tags returned by VIES. */
export function parseViesResponse(text) {
  const fault = xmlValue(text, "faultstring");
  if (fault) return { fault };
  return {
    valid: xmlValue(text, "valid")?.toLowerCase() === "true",
    name: xmlValue(text, "name"),
    address: xmlValue(text, "address"),
  };
}

function escapeXml(value) {
  return String(value ?? "").replace(/[<>&'"]/g, (c) => ({
    "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;",
  }[c]));
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function unavailableResult(message) {
  return { success: false, reason: "VIES_UNAVAILABLE", message };
}

/**
 * DEV-ONLY escape hatch for local testing against VAT numbers that are
 * well-formed but deliberately not real — e.g. the freshly-minted
 * identifiers used to register two sandbox companies on the Peppol *test*
 * network, which by definition cannot exist in VIES.
 *
 * Hard-gated on NODE_ENV: even with the variable set, this is inert in a
 * production build. That gate is the whole point — VIES confirmation is
 * what lets tax-policy.js grant a 0 % intra-Community treatment, so a
 * bypass reaching production would mean untaxed sales backed by an
 * unverified number. It must never become "just another config flag".
 *
 * Note this only skips the *registry* lookup: isValidVatFormat() (including
 * Belgium's mod-97 checksum) still runs first and still rejects garbage.
 */
function isViesBypassEnabled() {
  return process.env.NODE_ENV !== "production" && process.env.VAT_SKIP_VIES_VERIFICATION === "true";
}

function invalidResult(message = "Numéro de TVA invalide.") {
  return { success: true, valid: false, message };
}

function validResult({ valid, name, address, requestIdentifier }) {
  return {
    success: true,
    valid,
    name: name && name !== "---" ? name : null,
    address: address && address !== "---" ? String(address).replace(/\r?\n/g, ", ") : null,
    requestIdentifier: requestIdentifier || null,
  };
}

function firstRestError(payload) {
  return payload?.errorWrappers?.[0]?.error ?? payload?.errorWrappers?.[0]?.message ?? null;
}

async function verifyVatWithViesRest(split) {
  let response;
  let payload;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    response = await fetch(VIES_REST_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ countryCode: split.countryCode, vatNumber: split.body }),
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout));
    payload = await response.json().catch(async () => ({ raw: await response.text().catch(() => "") }));
  } catch (error) {
    console.error("[verifyVatWithViesRest] network error", error);
    return unavailableResult("Le service européen de vérification (VIES) est actuellement injoignable. Le numéro peut être enregistré en attente de vérification.");
  }

  if (response.ok && typeof payload?.valid === "boolean") {
    return validResult(payload);
  }

  const error = firstRestError(payload);
  console.error("[verifyVatWithViesRest] error", response.status, error ?? payload);
  if (error === "INVALID_INPUT") {
    return invalidResult();
  }
  return unavailableResult("Le service VIES reste temporairement indisponible pour ce pays. Le numéro peut être enregistré en attente de vérification.");
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
  const normalized = normalizeVatNumber(raw);
  const split = splitVat(normalized);
  if (!split || !isValidVatFormat(normalized)) {
    return {
      success: false,
      message: "Format de numéro de TVA invalide. Ajoutez le préfixe pays, par exemple BE, FR, DE ou NL.",
    };
  }

  // See isViesBypassEnabled() — local testing only, inert in production.
  //
  // A registered company name is part of the simulation, not decoration:
  // real VIES always returns one for a valid number, and invoicing.js
  // derives the whole B2B classification from it
  // (isB2B = isCompany && legalName). Returning null here would silently
  // downgrade every bypassed buyer to a B2C invoice — which is exactly the
  // opposite of what someone testing B2B e-invoicing needs. Deliberately
  // marked so it can never be mistaken for a real registry answer; a
  // BillingProfile.companyLegalName still takes precedence over it.
  if (isViesBypassEnabled()) {
    console.warn(
      `[verifyVatWithVies] VIES BYPASS ACTIVE (VAT_SKIP_VIES_VERIFICATION=true) — "${normalized}" accepted without any registry check. Never enable this outside local development.`
    );
    return validResult({ valid: true, name: `Société test ${normalized}`, address: null });
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

  for (let attempt = 0; attempt < VIES_MAX_ATTEMPTS; attempt += 1) {
    let response;
    let text;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      response = await fetch(VIES_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: '""' },
        body,
        signal: controller.signal,
      }).finally(() => clearTimeout(timeout));
      text = await response.text();
    } catch (error) {
      console.error(`[verifyVatWithVies] network error (attempt ${attempt + 1})`, error);
      if (attempt < VIES_MAX_ATTEMPTS - 1) {
        await wait(VIES_RETRY_DELAYS_MS[attempt]);
        continue;
      }
      return verifyVatWithViesRest(split);
    }

    const parsed = parseViesResponse(text);
    if (parsed.fault) {
      const fault = parsed.fault || "UNKNOWN";
      console.error(`[verifyVatWithVies] SOAP fault (attempt ${attempt + 1})`, fault);
      if (fault === "INVALID_INPUT") {
        return invalidResult();
      }
      if (attempt < VIES_MAX_ATTEMPTS - 1) {
        await wait(VIES_RETRY_DELAYS_MS[attempt]);
        continue;
      }
      return verifyVatWithViesRest(split);
    }

    if (!response.ok) {
      console.error(`[verifyVatWithVies] HTTP error (attempt ${attempt + 1})`, response.status, text.slice(0, 500));
      if (attempt < VIES_MAX_ATTEMPTS - 1) {
        await wait(VIES_RETRY_DELAYS_MS[attempt]);
        continue;
      }
      return verifyVatWithViesRest(split);
    }

    const valid = parsed.valid;
    const name = parsed.name || null;
    const address = parsed.address?.replace(/\r?\n/g, ", ") || null;

    return validResult({ valid, name, address });
  }
}
