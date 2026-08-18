/**
 * Belgian shipping cost calculation (Marie's requirements)
 * - Free shipping for orders over €150
 * - Otherwise: calculate by weight tiers, exact carrier cost + 21% VAT, no markup
 *
 * Carrier switched from bpost to Mondial Relay (client dropped bpost as too
 * expensive) — see PROJECT_REQUIREMENTS.md. Real rates below, confirmed by
 * Marie (form response, 10 Aug 2026) as "Offre Start" — Point Relais® /
 * Locker delivery to Belgium, screenshotted from her Mondial Relay Business
 * Solutions account (mondialrelay.be/fr-be/solutionspro/offres-et-services/
 * offre-start/tarifs-et-paiement) on 11 Aug 2026.
 *
 * That page prices by TWO axes: parcel weight (rows) and the seller's
 * monthly parcel VOLUME (columns — 0-9/mois up to 250+/mois, each higher
 * tier earning a loyalty discount up to 10%). The app has no way to know
 * Marie's actual current monthly volume, so it deliberately uses the
 * lowest/base column — "0-9 colis/mois", the undiscounted public price —
 * never a volume discount she might not actually be earning yet. Worst
 * case she pays less than modeled (extra margin); it can never charge less
 * than what Mondial Relay actually bills her.
 */

import { roundMoney } from "@/lib/tax-policy";

const FREE_SHIPPING_THRESHOLD = 150; // €
const BELGIUM_VAT_RATE = 21;

function round2(n) {
  return roundMoney(n);
}

function priceInclVat(priceHT) {
  return round2(priceHT * (1 + BELGIUM_VAT_RATE / 100));
}

// Mondial Relay "Offre Start" base tier (0-9 colis/mois, 0% loyalty
// discount — "prix public"), prices HT per the source grid; priceInclVat()
// applies Belgium's 21% VAT with no markup, per policy.
const MONDIAL_RELAY_TIERS = [
  { maxGrams: 500, price: priceInclVat(3.12) },    // jusqu'à 500g
  { maxGrams: 1000, price: priceInclVat(3.22) },   // jusqu'à 1kg
  { maxGrams: 2000, price: priceInclVat(3.42) },   // jusqu'à 2kg
  { maxGrams: 4000, price: priceInclVat(3.82) },   // jusqu'à 4kg
  { maxGrams: 10000, price: priceInclVat(5.43) },  // jusqu'à 10kg
  { maxGrams: 25000, price: priceInclVat(14.77) }, // jusqu'à 25kg
  { maxGrams: 30000, price: priceInclVat(19.99) }, // jusqu'à 30kg (max Mondial Relay parcel)
];

/**
 * Calculate shipping cost based on total weight
 * @param {number} totalWeightGrams - Total weight in grams
 * @param {number} orderSubtotal - Order subtotal before shipping (EUR)
 * @returns {number|string} Shipping cost in EUR (TVA included), or "QUOTE_REQUIRED" for >30kg
 */
export function calculateShippingCost(totalWeightGrams, orderSubtotal) {
  // Free shipping for orders over €150
  if (orderSubtotal >= FREE_SHIPPING_THRESHOLD) {
    return 0;
  }

  // Find appropriate weight tier
  const tier = MONDIAL_RELAY_TIERS.find(t => totalWeightGrams <= t.maxGrams);

  if (!tier) {
    // Over 30kg - cannot auto-calculate, requires manual quote
    // Return special value to block checkout
    return "QUOTE_REQUIRED";
  }

  return tier.price;
}

/**
 * Calculate total weight of cart items
 * @param {Array} items - Cart items with variant data
 * @returns {number} Total weight in grams
 */
export function calculateTotalWeight(items) {
  return items.reduce((total, item) => {
    const itemWeight = (item.variant?.weightGrams || 0) * item.quantity;
    return total + itemWeight;
  }, 0);
}

/**
 * Get shipping cost breakdown for display
 * @param {number} totalWeightGrams - Total weight in grams
 * @param {number} orderSubtotal - Order subtotal before shipping
 * @returns {object|string} Shipping details, or "QUOTE_REQUIRED" for >30kg
 */
export function getShippingDetails(totalWeightGrams, orderSubtotal) {
  const isFree = orderSubtotal >= FREE_SHIPPING_THRESHOLD;
  const cost = calculateShippingCost(totalWeightGrams, orderSubtotal);

  // Calculate amount until free shipping
  const untilFree = isFree ? 0 : Math.max(0, FREE_SHIPPING_THRESHOLD - orderSubtotal);

  // Find which tier was applied
  const appliedTier = !isFree ? MONDIAL_RELAY_TIERS.find(t => totalWeightGrams <= t.maxGrams) : null;
  const nextTier = !isFree ? MONDIAL_RELAY_TIERS.find(t => totalWeightGrams > t.maxGrams) : null;

  return {
    cost,
    isFree,
    totalWeightGrams,
    totalWeightKg: totalWeightGrams / 1000,
    untilFree,
    appliedTier: appliedTier ? {
      maxWeightKg: appliedTier.maxGrams / 1000,
      price: appliedTier.price
    } : null,
    nextTier: nextTier ? {
      maxWeightKg: nextTier.maxGrams / 1000,
      price: nextTier.price,
      weightNeeded: nextTier.maxGrams - totalWeightGrams + 1
    } : null,
    freeShippingThreshold: FREE_SHIPPING_THRESHOLD
  };
}
