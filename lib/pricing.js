/**
 * Pricing calculations for cart display (Belgian TVA requirements)
 * Shows customers the full breakdown: before discount, before TVA, TVA amount, total
 *
 * ProductVariant.price is stored TTC. serializeCart carries a derived
 * `priceExclVat` twin so this helper can apply the buyer's actual rate without
 * ever adding 21% to the stored customer price.
 */

import { calculateVatTotals, applyVatRate } from "@/lib/tax-policy";

const TVA_RATE = 21; // 21% Belgian catalogue rate

/**
 * Calculate complete price breakdown for a cart item
 * @param {object} item - Cart item with variant data
 * @returns {object} Price breakdown
 */
export function calculateItemPricing(item, vatRate = TVA_RATE) {
  const quantity = item.quantity;
  const price = Number(item.variant.priceExclVat);
  const comparePrice =
    item.variant.comparePriceExclVat != null ? Number(item.variant.comparePriceExclVat) : null;

  // The HT twin was extracted from the stored TTC price. Apply the buyer's
  // rate to the unit before multiplying so preview and order creation match.
  const unitPrice = applyVatRate(price, vatRate);
  const totalPrice = unitPrice * quantity;
  const { totalExclVat: subtotalExclVat, vatAmount } = calculateVatTotals(totalPrice, vatRate);

  // If there's a compare price (promotional price), show the savings
  let originalPrice = null;
  let originalSubtotalExclVat = null;
  let originalVatAmount = null;
  let savings = null;
  let unitComparePrice = null;

  if (comparePrice && comparePrice > price) {
    unitComparePrice = applyVatRate(comparePrice, vatRate);
    originalPrice = unitComparePrice * quantity;
    const originalTotals = calculateVatTotals(originalPrice, vatRate);
    originalSubtotalExclVat = originalTotals.totalExclVat;
    originalVatAmount = originalTotals.vatAmount;
    savings = originalPrice - totalPrice;
  }

  return {
    quantity,
    unitPrice,
    unitComparePrice,
    totalPrice,                    // Final TTC price
    subtotalExclVat,               // Before TVA
    vatAmount,                     // TVA amount (21%)
    originalPrice: originalPrice,           // Before promotion (if applicable)
    originalSubtotalExclVat: originalSubtotalExclVat, // Before promotion, before TVA
    originalVatAmount: originalVatAmount,    // TVA on original price
    savings: savings                      // Discount amount
  };
}

/**
 * Calculate cart total pricing breakdown
 * @param {Array} items - Cart items
 * @returns {object} Cart pricing summary
 */
export function calculateCartPricing(items, vatRate = TVA_RATE) {
  let totalTTC = 0;
  let totalHT = 0;
  let totalVAT = 0;
  let totalOriginalTTC = 0;
  let totalOriginalHT = 0;
  let totalSavings = 0;

  for (const item of items) {
    const pricing = calculateItemPricing(item, vatRate);
    totalTTC += pricing.totalPrice;
    totalHT += pricing.subtotalExclVat;
    totalVAT += pricing.vatAmount;

    if (pricing.originalPrice) {
      totalOriginalTTC += pricing.originalPrice;
      totalOriginalHT += pricing.originalSubtotalExclVat;
      totalSavings += pricing.savings;
    }
  }

  return {
    totalHT,              // Total before TVA
    totalVAT,             // Total TVA amount (21%)
    totalTTC,             // Final total TTC
    totalOriginalHT: totalOriginalHT || 0,    // Before promotion, before TVA
    totalOriginalTTC: totalOriginalTTC || 0,  // Before promotion (TTC)
    totalSavings: totalSavings || 0,          // Total discount amount
    hasPromotions: totalSavings > 0
  };
}

/**
 * Format price for display
 * @param {number} price - Price amount
 * @returns {string} Formatted price
 */
export function formatPrice(price) {
  return `€${price.toFixed(2)}`;
}
