/**
 * Mondial Relay shipping cost calculation (Marie's requirements)
 * - Free shipping for orders over €150
 * - Otherwise: calculate by weight tiers, exact carrier cost net of VAT, no markup
 *
 * Carrier switched from bpost to Mondial Relay (client dropped bpost as too
 * expensive) — see PROJECT_REQUIREMENTS.md. Point Relais® / Locker delivery
 * from Belgium, to a relay point in Belgium or in France.
 *
 * Belgium: Marie's "Offre Start" grid, screenshotted from her Mondial Relay
 * Business Solutions account on 11 Aug 2026 (base "0-9 colis/mois" column,
 * no volume discount assumed).
 * France: "Tarifs professionnels applicables au 1er Janvier 2025" (HT,
 * "Offre de livraison en Lockers et Points relais", France column) on
 * mondialrelay.be/fr-be/solutionspro/offres-et-services/offre-start/
 * tarifs-et-paiement — screenshotted by the user on 19 Oct 2026.
 */


const FREE_SHIPPING_THRESHOLD = 150; // €

// The product catalogue is stored TTC, but this carrier grid is different: it
// is genuinely HT. VAT is applied once at the point the customer's rate is
// known, so an intra-Community B2B order also gets the correct carriage rate.
// In the France source, 0,25 kg and 0,5 kg share one price, hence its first row.
const MONDIAL_RELAY_TIERS_BY_COUNTRY = {
  // Unchanged from the 11 Aug 2026 grid (Marie's "Offre Start", 0-9
  // colis/mois column) — deliberately left as-is when France was added.
  BE: [
    { maxGrams: 500, price: 3.12 },
    { maxGrams: 1000, price: 3.22 },
    { maxGrams: 2000, price: 3.42 },
    { maxGrams: 4000, price: 3.82 },
    { maxGrams: 10000, price: 5.43 },
    { maxGrams: 25000, price: 14.77 },
    { maxGrams: 30000, price: 19.99 }, // max Mondial Relay parcel
  ],
  // "Tarifs professionnels applicables au 1er Janvier 2025", France column.
  FR: [
    { maxGrams: 500, price: 4.51 },
    { maxGrams: 1000, price: 4.70 },
    { maxGrams: 2000, price: 5.07 },
    { maxGrams: 3000, price: 5.26 },
    { maxGrams: 4000, price: 5.45 },
    { maxGrams: 5000, price: 5.63 },
    { maxGrams: 7000, price: 7.06 },
    { maxGrams: 10000, price: 8.56 },
    { maxGrams: 15000, price: 11.95 },
    { maxGrams: 20000, price: 13.45 },
    { maxGrams: 25000, price: 23.14 },
    { maxGrams: 30000, price: 23.14 },
  ],
};

export const SHIPPING_COUNTRIES = Object.keys(MONDIAL_RELAY_TIERS_BY_COUNTRY);

const POSTAL_CODE_PATTERNS = { BE: /^\d{4}$/, FR: /^\d{5}$/ };

export function isSupportedShippingCountry(countryCode) {
  return SHIPPING_COUNTRIES.includes(countryCode);
}

/** Relay point postal code check, shared by the checkout and the server. */
export function isValidPickupPostalCode(postalCode, countryCode = "BE") {
  const pattern = POSTAL_CODE_PATTERNS[countryCode];
  return Boolean(pattern) && pattern.test(String(postalCode ?? "").trim());
}

function tiersFor(countryCode) {
  const tiers = MONDIAL_RELAY_TIERS_BY_COUNTRY[countryCode];
  if (!tiers) throw new Error(`Livraison Mondial Relay non disponible vers « ${countryCode} ».`);
  return tiers;
}

/**
 * Calculate shipping cost based on total weight
 * @param {number} totalWeightGrams - Total weight in grams
 * @param {number} orderSubtotal - Order subtotal before shipping (EUR)
 * @param {string} [countryCode] - relay point country, "BE" or "FR"
 * @returns {number|string} Shipping cost in EUR, NET of VAT (applyVatRate adds it), or "QUOTE_REQUIRED" for >30kg
 */
export function calculateShippingCost(totalWeightGrams, orderSubtotal, countryCode = "BE") {
  const tiers = tiersFor(countryCode);

  // Free shipping for orders over €150
  if (orderSubtotal >= FREE_SHIPPING_THRESHOLD) {
    return 0;
  }

  // Find appropriate weight tier
  const tier = tiers.find(t => totalWeightGrams <= t.maxGrams);

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
export function getShippingDetails(totalWeightGrams, orderSubtotal, countryCode = "BE") {
  const tiers = tiersFor(countryCode);
  const isFree = orderSubtotal >= FREE_SHIPPING_THRESHOLD;
  const cost = calculateShippingCost(totalWeightGrams, orderSubtotal, countryCode);

  // Calculate amount until free shipping
  const untilFree = isFree ? 0 : Math.max(0, FREE_SHIPPING_THRESHOLD - orderSubtotal);

  // Find which tier was applied
  const appliedTier = !isFree ? tiers.find(t => totalWeightGrams <= t.maxGrams) : null;
  const nextTier = !isFree ? tiers.find(t => totalWeightGrams > t.maxGrams) : null;

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
