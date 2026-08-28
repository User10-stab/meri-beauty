/**
 * Billit e-invoicing (Peppol network) — order creation only.
 *
 * Deliberately mirrors the production behaviour already shipped for this
 * exact flow elsewhere (the Entreprise Tracker's manual "Envoyer via
 * Billit" action): this only ever POSTs an order to Billit's
 * `/v1/orders`. It never calls Billit's separate "send"/dispatch endpoint —
 * Peppol vs. e-mail delivery, and to whom, is finished by staff inside
 * Billit's own dashboard. That way a missing or malformed Peppol identifier
 * here can never silently misroute a legally issued invoice; worst case,
 * Billit just has nothing to route automatically and the order sits there
 * for manual completion.
 */

import { prisma } from "@/lib/prisma";

const BASE_URL = (process.env.BILLIT_BASE_URL || "https://api.sandbox.billit.be").replace(/\/$/, "");

/**
 * Resolves the Billit API key: DB value (Salon.billitApiKey) takes priority
 * over the environment variable, so the key can be updated from the admin
 * dashboard without a redeployment.
 */
async function resolveBillitApiKey() {
  try {
    const salon = await prisma.salon.findUnique({
      where: { id: "main-salon" },
      select: { billitApiKey: true },
    });
    if (salon?.billitApiKey?.trim()) return salon.billitApiKey.trim();
  } catch {
    // Fall through to env var
  }
  return process.env.BILLIT_API_KEY ?? null;
}

/**
 * Parses a Peppol participant identifier stored as "schemeID:value"
 * (e.g. "9925:BE0823758741" — 9925 is the Peppol scheme for a Belgian
 * enterprise number). Returns null on anything that doesn't match, so
 * callers can treat an unparsable value as "no Peppol routing" rather than
 * fail the whole order.
 */
export function parsePeppolIdentifier(raw) {
  const trimmed = String(raw ?? "").trim();
  const match = trimmed.match(/^(\d{4}):([\w.-]+)$/);
  if (!match) return null;
  return { schemeID: match[1], value: match[2] };
}

/**
 * Billit sending here is scoped to Belgian B2B customers only (see the
 * guard in actions/invoices/send-invoice-billit.js) — a Peppol invoice from
 * this salon only makes sense for a domestic company. Checks the "BE"
 * prefix only; the number's actual validity was already established by
 * VIES before it was ever saved (see lib/vat-validation.js). Exported so
 * the dashboard button can disable itself with the same rule the server
 * enforces, instead of a second hand-written regex drifting from it.
 */
export function isBelgianVatNumber(vatNumber) {
  return /^BE/i.test(String(vatNumber ?? "").trim());
}

function extractOrderId(response) {
  if (typeof response === "number") return response;
  if (typeof response === "string" && /^\d+$/.test(response)) return Number(response);
  if (response && typeof response === "object") {
    return response.Id ?? response.OrderId ?? response.Order?.Id ?? response.id ?? null;
  }
  return null;
}

/**
 * Creates an order (invoice) in Billit. `payload` follows Billit's
 * OrderType=Invoice schema — see actions/invoices/send-invoice-billit.js
 * for how a Meri Beauty Invoice is mapped onto it.
 *
 * @returns {Promise<{success: boolean, orderId?: number|string|null, message?: string}>}
 */
export async function createBillitOrder(payload) {
  const apiKey = await resolveBillitApiKey();
  if (!apiKey) {
    return { success: false, message: "Billit n'est pas configuré (clé API manquante — renseignez-la dans Réglages > Salon ou dans BILLIT_API_KEY)." };
  }

  let response;
  try {
    response = await fetch(`${BASE_URL}/v1/orders`, {
      method: "POST",
      headers: { ApiKey: apiKey, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    console.error("[billit] network error", error);
    return { success: false, message: "Impossible de contacter Billit." };
  }

  const text = await response.text();

  if (!response.ok) {
    console.error("[billit] HTTP error", response.status, text.slice(0, 1000));
    return { success: false, message: `Billit a refusé la facture (HTTP ${response.status}).` };
  }

  let parsed = text;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    // Billit can return a bare numeric id as plain text — keep it as-is.
  }

  return { success: true, orderId: extractOrderId(parsed) };
}
