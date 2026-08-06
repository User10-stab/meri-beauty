/**
 * Belgian shipping cost calculation (Marie's requirements)
 * - Free shipping for orders over €150
 * - Otherwise: calculate by weight tiers, exact carrier cost + 21% VAT, no markup
 *
 * Carrier switched from bpost to Mondial Relay (client dropped bpost as too
 * expensive) — see PROJECT_REQUIREMENTS.md. Marie has not yet provided the
 * real Mondial Relay rate grid (blocker: she needs to check whether her old
 * Shopify-era Mondial Relay account is still active). The tiers below are
 * PLACEHOLDERS carried over from the old bpost rates purely so checkout keeps
 * producing a number — replace every price here with Mondial Relay's real
 * base-tier (no volume discount) rates the moment Marie sends them.
 */

const FREE_SHIPPING_THRESHOLD = 150; // €
const BELGIUM_VAT_RATE = 21;

// PLACEHOLDER — not real Mondial Relay rates. Swap in the real base-tier
// price grid (cost + 21% VAT, no markup) as soon as Marie provides it.
const MONDIAL_RELAY_TIERS_PLACEHOLDER = [
  { maxGrams: 500, price: 7.50 },   // Up to 500g
  { maxGrams: 1000, price: 9.00 },  // 501g - 1kg
  { maxGrams: 2000, price: 11.50 }, // 1kg - 2kg
  { maxGrams: 3000, price: 14.00 },  // 2kg - 3kg
  { maxGrams: 5000, price: 17.00 },  // 3kg - 5kg
  { maxGrams: 10000, price: 22.00 }, // 5kg - 10kg
  { maxGrams: 30000, price: 35.00 }, // 10kg - 30kg (max Mondial Relay parcel)
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
  const tier = MONDIAL_RELAY_TIERS_PLACEHOLDER.find(t => totalWeightGrams <= t.maxGrams);

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
  const appliedTier = !isFree ? MONDIAL_RELAY_TIERS_PLACEHOLDER.find(t => totalWeightGrams <= t.maxGrams) : null;
  const nextTier = !isFree ? MONDIAL_RELAY_TIERS_PLACEHOLDER.find(t => totalWeightGrams > t.maxGrams) : null;

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
