/**
 * Which boutique orders the « Encaisser » button hands over to the till.
 *
 * Only a pay-at-pickup order nobody has paid yet: its items are still held
 * in reservedQuantity, so the till can take them over, let staff add or
 * remove lines, and sell the result as one counter sale. The till then
 * closes the original order in the same transaction (see
 * completePointOfSaleSale's sourceOrderId).
 *
 * An expired pickup still qualifies while its stock has not been released
 * (the reservation is still in place — see lib/orders/expire-stale-orders.js);
 * once released, those units may already be promised to somebody else.
 *
 * Shared by the orders list (button visibility), the draft loader and the
 * sale itself, so the three can never disagree.
 */
export const POS_HANDOFF_STATUSES = ["PENDING_PICKUP", "READY_FOR_PICKUP", "EXPIRED"];

export function canSettleOrderAtPointOfSale(order) {
  if (!order) return false;
  if (order.fulfilmentMode !== "PICKUP_ON_SITE") return false;
  if (order.payment || order.hasPayment) return false;
  if (!POS_HANDOFF_STATUSES.includes(order.status)) return false;
  if (order.status === "EXPIRED" && order.stockReleasedAt) return false;
  return true;
}
