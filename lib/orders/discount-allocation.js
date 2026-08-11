/**
 * Prorates a whole-order promo discount across its line items in cents, so
 * a "net remboursable" amount exists per order item even though Order only
 * stores one aggregate discountAmount. Used by returns.js to compute a fair
 * partial refund instead of each returned item's full pre-discount price —
 * see bigbatch.txt P0 "Les promotions rendent les retours partiels
 * incorrects": without this, returning item A first refunds its full face
 * value, then item B's later return gets wrongly rejected because the
 * refund cap (bounded by what was actually paid) is nearly exhausted.
 *
 * Allocation is by cents: each item's share starts at
 * floor(discount * itemFaceValueCents / subtotalCents), then the leftover
 * cents from rounding down are handed out one by one, largest fractional
 * remainder first — so the total allocated always equals discountAmount
 * exactly and no single item silently absorbs all the rounding error.
 *
 * Returns a Map(orderItemId -> net amount for that item's full original
 * quantity, in euros). A fully-discounted (free) order yields 0 for every
 * item, never a negative or NaN amount.
 */
export function allocateOrderDiscount(order) {
  const items = order.items;
  const discountCents = Math.round(Number(order.discountAmount) * 100);

  if (discountCents <= 0) {
    return new Map(items.map((item) => [item.id, Number(item.unitPrice) * item.quantity]));
  }

  const faceCentsByItemId = new Map(
    items.map((item) => [item.id, Math.round(Number(item.unitPrice) * item.quantity * 100)])
  );
  const subtotalCents = [...faceCentsByItemId.values()].reduce((sum, c) => sum + c, 0);

  if (subtotalCents <= 0) {
    return new Map(items.map((item) => [item.id, 0]));
  }

  // Never allocate more discount than the order actually has face value for
  // — defensive only, discountAmount should never exceed subtotal.
  const cappedDiscountCents = Math.min(discountCents, subtotalCents);

  const shares = items.map((item) => {
    const faceCents = faceCentsByItemId.get(item.id);
    const exact = (cappedDiscountCents * faceCents) / subtotalCents;
    const floor = Math.floor(exact);
    return { id: item.id, faceCents, discountCents: floor, remainder: exact - floor };
  });

  let leftover = cappedDiscountCents - shares.reduce((sum, s) => sum + s.discountCents, 0);
  const byRemainderDesc = [...shares].sort((a, b) => b.remainder - a.remainder);
  for (let i = 0; i < leftover; i++) {
    byRemainderDesc[i % byRemainderDesc.length].discountCents += 1;
  }

  return new Map(shares.map((share) => [share.id, Math.max(0, share.faceCents - share.discountCents) / 100]));
}
