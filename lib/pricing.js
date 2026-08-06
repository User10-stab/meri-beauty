/**
 * Pricing calculations for cart display (Belgian TVA requirements)
 * Shows customers the full breakdown: before discount, before TVA, TVA amount, total
 */

const TVA_RATE = 21; // 21% Belgian rate

/**
 * Calculate complete price breakdown for a cart item
 * @param {object} item - Cart item with variant data
 * @returns {object} Price breakdown
 */
export function calculateItemPricing(item) {
  const quantity = item.quantity;
  const price = Number(item.variant.price);
  const comparePrice = item.variant.comparePrice ? Number(item.variant.comparePrice) : null;

  const totalPrice = price * quantity;
  const subtotalExclVat = totalPrice / (1 + TVA_RATE / 100);
  const vatAmount = totalPrice - subtotalExclVat;

  // If there's a compare price (promotional price), show the savings
  let originalPrice = null;
  let originalSubtotalExclVat = null;
  let originalVatAmount = null;
  let savings = null;

  if (comparePrice && comparePrice > price) {
    originalPrice = comparePrice * quantity;
    originalSubtotalExclVat = originalPrice / (1 + TVA_RATE / 100);
    originalVatAmount = originalPrice - originalSubtotalExclVat;
    savings = originalPrice - totalPrice;
  }

  return {
    quantity,
    unitPrice: price,
    unitComparePrice: comparePrice,
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
export function calculateCartPricing(items) {
  let totalTTC = 0;
  let totalHT = 0;
  let totalVAT = 0;
  let totalOriginalTTC = 0;
  let totalOriginalHT = 0;
  let totalSavings = 0;

  for (const item of items) {
    const pricing = calculateItemPricing(item);
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
