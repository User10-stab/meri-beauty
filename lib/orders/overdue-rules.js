/**
 * Shared rule for "this order has stalled mid-fulfilment" — imported by both
 * the cron reminder job (lib/orders/notify-stale-fulfilment.js) and the
 * admin orders list (components/dashboard/boutique/OrdersPageClient.jsx), so
 * the badge shown to staff and the notification that was actually sent can
 * never disagree about which orders count as overdue.
 *
 * Deliberately separate from lib/orders/expire-stale-orders.js: that module
 * auto-cancels/restocks PICKUP_ON_SITE orders past their hard 7-day
 * `expiresAt` deadline. This module never cancels or touches stock — it only
 * flags orders (prepaid pickups included, which never auto-expire) so a
 * human notices and acts.
 */

export const ORDER_OVERDUE_THRESHOLD_DAYS = 3;

const THRESHOLD_MS = ORDER_OVERDUE_THRESHOLD_DAYS * 24 * 60 * 60 * 1000;

function olderThanThreshold(date, now) {
  if (!date) return false;
  const timestamp = date instanceof Date ? date.getTime() : new Date(date).getTime();
  if (Number.isNaN(timestamp)) return false;
  return now.getTime() - timestamp > THRESHOLD_MS;
}

/**
 * @param {{ fulfilmentMode: string, status: string, createdAt: Date|string, readyForPickupAt?: Date|string|null, shippedAt?: Date|string|null, collectedAt?: Date|string|null }} order
 * @param {Date} [now]
 * @returns {"NOT_PREPARED" | "NOT_COLLECTED" | "NOT_CONFIRMED_DELIVERED" | null}
 */
export function getOrderOverdueReason(order, now = new Date()) {
  if (!order) return null;
  const { fulfilmentMode, status } = order;

  const isPickupMode = fulfilmentMode === "PICKUP_PREPAID" || fulfilmentMode === "PICKUP_ON_SITE";

  // A. Paid/confirmed but staff never started prep (pickup) or never shipped it.
  if (isPickupMode && (status === "PENDING_PICKUP" || status === "PAID")) {
    if (olderThanThreshold(order.createdAt, now)) return "NOT_PREPARED";
    return null;
  }
  if (fulfilmentMode === "SHIPPING_PREPAID" && status === "PROCESSING") {
    if (olderThanThreshold(order.createdAt, now)) return "NOT_PREPARED";
    return null;
  }

  // B. Ready for pickup, nobody came (or nobody scanned them in).
  if (isPickupMode && status === "READY_FOR_PICKUP") {
    if (olderThanThreshold(order.readyForPickupAt, now)) return "NOT_COLLECTED";
    return null;
  }

  // C. Shipped, never confirmed received.
  if (fulfilmentMode === "SHIPPING_PREPAID" && status === "SHIPPED" && !order.collectedAt) {
    if (olderThanThreshold(order.shippedAt, now)) return "NOT_CONFIRMED_DELIVERED";
    return null;
  }

  return null;
}
