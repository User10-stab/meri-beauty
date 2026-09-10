/**
 * Peppyrus (peppyrus.be) — free Peppol access point, replacing Billit.
 *
 * Unlike Billit, Peppyrus is a bare transport layer: it does not build UBL
 * for us (see lib/peppyrus/build-ubl.js) and POST /message is not a staging
 * step — it IS the live Peppol transmission. There is no vendor dashboard
 * where staff finish the send afterward.
 */

import { prisma } from "@/lib/prisma";

const BASE_URL = (process.env.PEPPYRUS_BASE_URL || "https://api.test.peppyrus.be/v1").replace(/\/$/, "");

// Confirmed from Peppyrus's OpenAPI spec — shared process type, and the two
// document types this app ever sends.
export const PEPPYRUS_PROCESS_TYPE = "cenbii-procid-ubl::urn:fdc:peppol.eu:2017:poacc:billing:01:1.0";
export const PEPPYRUS_DOCUMENT_TYPE_INVOICE =
  "busdox-docid-qns::urn:oasis:names:specification:ubl:schema:xsd:Invoice-2::Invoice##urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0::2.1";
export const PEPPYRUS_DOCUMENT_TYPE_CREDIT_NOTE =
  "busdox-docid-qns::urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2::CreditNote##urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0::2.1";

/**
 * Resolves the Peppyrus API key: DB value (Salon.peppyrusApiKey) takes
 * priority over the environment variable, so the key can be updated from the
 * admin dashboard without a redeployment. Note the key must match whichever
 * environment PEPPYRUS_BASE_URL currently points at — test and prod are
 * separate Peppyrus accounts with separate keys, unlike Billit's single key.
 */
async function resolvePeppyrusApiKey() {
  try {
    const salon = await prisma.salon.findUnique({
      where: { id: "main-salon" },
      select: { peppyrusApiKey: true },
    });
    if (salon?.peppyrusApiKey?.trim()) return salon.peppyrusApiKey.trim();
  } catch {
    // Fall through to env var
  }
  return process.env.PEPPYRUS_API_KEY ?? null;
}

/**
 * Parses a Peppol participant identifier stored as "schemeID:value"
 * (e.g. "9925:BE0823758741" — 9925 is the Peppol scheme for a Belgian
 * enterprise number). Returns null on anything that doesn't match, so
 * callers can treat an unparsable value as "no Peppol routing" rather than
 * fail the whole send.
 */
export function parsePeppolIdentifier(raw) {
  const trimmed = String(raw ?? "").trim();
  const match = trimmed.match(/^(\d{4}):([\w.-]+)$/);
  if (!match) return null;
  return { schemeID: match[1], value: match[2] };
}

/**
 * Peppyrus sending here is scoped to Belgian B2B customers only (v1 scope —
 * see the guard in actions/invoices/send-invoice-peppyrus.js) — a Peppol
 * invoice from this salon only makes sense for a domestic company for now.
 * Checks the "BE" prefix only; the number's actual validity was already
 * established by VIES before it was ever saved (see lib/vat-validation.js).
 * Exported so the dashboard button can disable itself with the same rule the
 * server enforces, instead of a second hand-written regex drifting from it.
 */
export function isBelgianVatNumber(vatNumber) {
  return /^BE/i.test(String(vatNumber ?? "").trim());
}

async function peppyrusFetch(path, { method = "GET", body } = {}) {
  const apiKey = await resolvePeppyrusApiKey();
  if (!apiKey) {
    return {
      success: false,
      message: "Peppyrus n'est pas configuré (clé API manquante — renseignez-la dans Réglages > Salon ou dans PEPPYRUS_API_KEY).",
    };
  }

  let response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: {
        "X-Api-Key": apiKey,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch (error) {
    console.error("[peppyrus] network error", error);
    return { success: false, message: "Impossible de contacter Peppyrus." };
  }

  const text = await response.text();
  let parsed = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }

  if (response.ok) {
    return { success: true, data: parsed };
  }

  switch (response.status) {
    case 401:
      return { success: false, message: "Peppyrus a refusé la clé API (401) — vérifiez qu'elle correspond au bon environnement (test/prod)." };
    case 404:
      return { success: false, message: "Ressource introuvable sur Peppyrus (404)." };
    case 422: {
      const detail = typeof parsed === "string" ? parsed : (parsed?.message ?? JSON.stringify(parsed ?? {}));
      return { success: false, message: `Peppyrus a rejeté le document (422) : ${detail}`.slice(0, 1000) };
    }
    default:
      console.error("[peppyrus] HTTP error", response.status, text.slice(0, 1000));
      return { success: false, message: `Peppyrus a renvoyé une erreur inattendue (HTTP ${response.status}).` };
  }
}

/**
 * Sends a document (invoice or credit note) over the live Peppol network.
 * `fileContent` must already be a base64-encoded, EN16931-compliant UBL 2.1
 * XML string — see lib/peppyrus/build-ubl.js.
 *
 * @returns {Promise<{success: boolean, messageId?: string|null, message?: string}>}
 */
export async function sendPeppyrusMessage({ sender, recipient, processType, documentType, fileContent }) {
  const result = await peppyrusFetch("/message", {
    method: "POST",
    body: { sender, recipient, processType, documentType, fileContent },
  });
  if (!result.success) return result;
  return { success: true, messageId: result.data?.id ?? null };
}

/**
 * Non-blocking pre-send check: does this participant exist and can it
 * receive documents on Peppol? Returns { canReceive, services } on success,
 * or { canReceive: false } on any failure (404 in particular — the recipient
 * simply isn't in the directory, which is expected/normal in test mode).
 */
export async function lookupPeppolParticipant(participantId) {
  if (!participantId) return { canReceive: false };
  const result = await peppyrusFetch(`/peppol/lookup?participantId=${encodeURIComponent(participantId)}`);
  if (!result.success) return { canReceive: false, message: result.message };
  const services = Array.isArray(result.data?.services) ? result.data.services : [];
  return { canReceive: services.length > 0, services, participantId: result.data?.participantId ?? participantId };
}

/**
 * Resolves a recipient's canonical Peppol participant ID from just a VAT
 * number — safer than trusting a possibly-stale BillingProfile.peppolParticipantId.
 * Returns null on any failure (no match, network error, etc.).
 */
export async function bestMatchPeppolParticipant({ vatNumber, countryCode }) {
  if (!vatNumber) return null;
  const params = new URLSearchParams({ vatNumber });
  if (countryCode) params.set("countryCode", countryCode);
  const result = await peppyrusFetch(`/peppol/bestMatch?${params.toString()}`);
  if (!result.success || !result.data?.participantId) return null;
  return result.data.participantId;
}

/**
 * EN16931 validation report for a sent message (FATAL/WARNING rule list).
 * Used by the self-loop verification flow and worth surfacing on failure.
 */
export async function getMessageReport(messageId) {
  const result = await peppyrusFetch(`/message/${encodeURIComponent(messageId)}/report`);
  if (!result.success) return result;
  return { success: true, ...result.data };
}
