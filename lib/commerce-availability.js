/**
 * Public boutique capabilities that must be enforced on the server as well
 * as represented in the checkout UI.
 *
 * Delivery is deliberately off by default in production until the carrier
 * integration is operational. Development stays usable without every local
 * .env needing an extra setting. Production can only re-enable it through
 * an explicit BOUTIQUE_SHIPPING_ENABLED=true deployment configuration.
 */
export function isBoutiqueShippingEnabled(environment = process.env) {
  const configured = String(environment.BOUTIQUE_SHIPPING_ENABLED ?? "").trim().toLowerCase();
  if (configured === "true") return true;
  if (configured === "false") return false;
  return environment.NODE_ENV !== "production";
}

export const BOUTIQUE_SHIPPING_DISABLED_MESSAGE =
  "La livraison est temporairement indisponible. Choisissez le retrait en boutique.";

/**
 * Narrower gate on top of isBoutiqueShippingEnabled, for validating the
 * real Mondial Relay production credentials against real traffic without
 * opening shipping to every customer at once. MONDIAL_RELAY_PILOT_EMAILS is
 * a comma-separated allowlist (mirrors the single-email
 * TILL_CASH_OPERATOR_EMAIL pattern in lib/authorization.js) — when it's set,
 * shipping is only usable by those accounts, on top of the base flag still
 * having to be on. When it's unset, this is identical to
 * isBoutiqueShippingEnabled — the pilot gate is opt-in, not a second switch
 * to remember to flip during normal operation.
 *
 * `email` may be null/undefined (an anonymous visitor, or a guest checkout
 * before the customer info is known) — that's simply "not in the pilot."
 */
export function isBoutiqueShippingEnabledFor(email, environment = process.env) {
  if (!isBoutiqueShippingEnabled(environment)) return false;

  const configured = String(environment.MONDIAL_RELAY_PILOT_EMAILS ?? "").trim();
  if (!configured) return true;

  const allowlist = configured
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return typeof email === "string" && allowlist.includes(email.trim().toLowerCase());
}
