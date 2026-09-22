/**
 * Following a Mondial Relay parcel: the public tracking page shown to the
 * customer, and the WSI2 SOAP tracing query used by staff.
 *
 * The tracing query is deliberately a *separate* integration from
 * lib/mondial-relay.js: Mondial Relay splits its offer across two unrelated
 * APIs with their own credentials ("Présentation des WebServices" V-1.1,
 * avril 2025) — API1/SOAP does pickup point search and tracing, API2/REST
 * creates shipments and labels. Only shipment creation was retired on API1;
 * tracing is current and has no API2 equivalent, so following a parcel
 * requires this second client and the Enseigne + private key pair.
 *
 * The contract below comes from the live WSDL
 * (api.mondialrelay.com/Web_Services.asmx?WSDL), not from documentation.
 *
 * Tracing is a read-only query — it cannot create or bill anything. Mondial
 * Relay asks that it not be used in batch, that a single shipment not be
 * polled more than 4-6 times a day, and that a settled shipment
 * (delivered/returned) stop being queried at all.
 */

import { createHash } from "crypto";

// Public tracking page. Mondial Relay may change the parameters it accepts,
// so we keep the official URL stable and display the shipment number beside
// the link for copy/paste.
export const MONDIAL_RELAY_TRACKING_URL = "https://www.mondialrelay.be/fr-be/suivi-de-colis/";

// The URL Mondial Relay lists for this account's API 1 parameters.
// api.mondialrelay.com/Web_Services.asmx serves the same contract, but this
// is the one the portal points at, so it is the one we follow.
const ENDPOINT = "https://api.mondialrelay.com/WebService.asmx";
const NAMESPACE = "http://www.mondialrelay.fr/webservice/";
const SOAP_ACTION = `${NAMESPACE}WSI2_TracingColisDetaille`;
const REQUEST_TIMEOUT_MS = 15_000;

function escapeXml(value) {
  return String(value ?? "").replace(/[<>&'"]/g, (c) => ({
    "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;",
  }[c]));
}

/**
 * WSI2 signs a call by MD5-hashing the concatenated parameter values with the
 * private key appended, uppercased. The key itself is never transmitted.
 */
function securityHash(enseigne, expedition, langue, privateKey) {
  return createHash("md5")
    .update(`${enseigne}${expedition}${langue}${privateKey}`, "utf8")
    .digest("hex")
    .toUpperCase();
}

export function getTracingCredentials(environment = process.env) {
  const enseigne = String(environment.MONDIAL_RELAY_WSI2_ENSEIGNE ?? "").trim();
  const privateKey = String(environment.MONDIAL_RELAY_WSI2_PRIVATE_KEY ?? "").trim();
  return enseigne && privateKey ? { enseigne, privateKey } : null;
}

// Confirmed against the live production webservice on 2026-09-22 by sending
// a bogus shipment number with, in turn, the real credentials, a wrong
// private key and a wrong Enseigne — each returns its own code, which is what
// makes "99" readable as "this shipment is unknown" rather than "auth failed".
const STAT_MESSAGES = {
  1: "Identifiant de marque (Enseigne) Mondial Relay invalide.",
  97: "Clé privée Mondial Relay invalide — le suivi ne peut pas être authentifié.",
  99: "Mondial Relay ne connaît pas ce numéro d'expédition, ou n'a encore aucune information dessus.",
};

function parseEvents(xml) {
  const block = xml.match(/<Tracing>([\s\S]*?)<\/Tracing>/)?.[1] ?? "";
  const field = (chunk, tag) =>
    chunk.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))?.[1]?.trim() || null;

  return [...block.matchAll(/<ret_WSI2_sub_TracingColisDetaille>([\s\S]*?)<\/ret_WSI2_sub_TracingColisDetaille>/g)]
    .map(([, chunk]) => ({
      label: field(chunk, "Libelle"),
      date: field(chunk, "Date"),
      time: field(chunk, "Heure"),
      location: field(chunk, "Emplacement"),
      pickupPointId: field(chunk, "Relais_Num"),
      countryCode: field(chunk, "Relais_Pays"),
    }))
    .filter((event) => event.label || event.date);
}

/**
 * Fetch the tracing history for one shipment.
 *
 * Never throws and never mutates anything — every failure mode (missing
 * credentials, network, HTTP, malformed body, Mondial Relay rejection)
 * resolves to `{ success: false, ... }` so a caller can surface it without
 * risking the request it was called from.
 *
 * @returns {Promise<{success: boolean, events: Array<{label: string|null, date: string|null, time: string|null, location: string|null, pickupPointId: string|null, countryCode: string|null}>, statusCode: string|null, message?: string, notConfigured?: boolean, rawResponse: string|null}>}
 */
export async function fetchShipmentTracing(shipmentNumber, { langue = "FR", environment = process.env } = {}) {
  const empty = { success: false, events: [], statusCode: null, rawResponse: null };

  const credentials = getTracingCredentials(environment);
  if (!credentials) {
    return { ...empty, notConfigured: true, message: "Le suivi Mondial Relay n'est pas configuré." };
  }

  const expedition = String(shipmentNumber ?? "").trim();
  if (!expedition) {
    return { ...empty, message: "Numéro d'expédition manquant." };
  }

  const { enseigne, privateKey } = credentials;
  const body = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
<soap:Body>
<WSI2_TracingColisDetaille xmlns="${NAMESPACE}">
<Enseigne>${escapeXml(enseigne)}</Enseigne>
<Expedition>${escapeXml(expedition)}</Expedition>
<Langue>${escapeXml(langue)}</Langue>
<Security>${securityHash(enseigne, expedition, langue, privateKey)}</Security>
</WSI2_TracingColisDetaille>
</soap:Body>
</soap:Envelope>`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: SOAP_ACTION },
      body,
      signal: controller.signal,
    });

    const text = await response.text();

    if (!response.ok) {
      console.error("[mondial-relay-tracing] HTTP error", response.status, text);
      return { ...empty, rawResponse: text, message: `Suivi indisponible (HTTP ${response.status}).` };
    }

    const statusCode = text.match(/<STAT>([^<]*)<\/STAT>/)?.[1]?.trim() ?? null;
    if (statusCode && statusCode !== "0") {
      return {
        ...empty,
        statusCode,
        rawResponse: text,
        message: STAT_MESSAGES[statusCode] ?? `Mondial Relay a refusé la demande de suivi (code ${statusCode}).`,
      };
    }

    return { success: true, events: parseEvents(text), statusCode, rawResponse: text };
  } catch (error) {
    console.error("[mondial-relay-tracing] request failed", error);
    return { ...empty, message: "Mondial Relay n'a pas répondu — suivi indisponible pour le moment." };
  } finally {
    clearTimeout(timeout);
  }
}
