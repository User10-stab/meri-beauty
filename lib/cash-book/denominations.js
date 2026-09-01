// Values in cents, not euros — 0.10 + 0.20 + 0.05 in floating point drifts
// to 0.35000000000000003, which is exactly the kind of off-by-a-fraction-
// of-a-cent that must never leak into a till count. Integer cents keep the
// whole calculation exact; only the final total is divided back to euros.
export const DENOMINATIONS_CENTS = Object.freeze([
  20000, 10000, 5000, 2000, 1000, 500, // billets: 200, 100, 50, 20, 10, 5 €
  200, 100, 50, 20, 10, 5, 2, 1, // pièces: 2, 1, 0.50, 0.20, 0.10, 0.05, 0.02, 0.01 €
]);

/**
 * Sums a denomination count map ({ [cents]: count }) into a euro total.
 * Negative or non-numeric counts are treated as zero rather than rejected —
 * this runs on every keystroke while staff is mid-count, and a half-typed
 * field must not throw or go negative.
 */
export function sumDenominationCounts(counts) {
  const totalCents = DENOMINATIONS_CENTS.reduce((sum, cents) => {
    const count = Math.max(0, Math.floor(Number(counts[cents]) || 0));
    return sum + cents * count;
  }, 0);
  return totalCents / 100;
}
