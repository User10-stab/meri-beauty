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
