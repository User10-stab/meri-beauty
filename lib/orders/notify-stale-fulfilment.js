import { prisma } from "@/lib/prisma";
import { getOrderOverdueReason } from "@/lib/orders/overdue-rules";
import {
  createNotificationsBulk,
  getSalonAdminNotificationRecipients,
  buildOrderFulfilmentOverdueNotification,
} from "@/lib/notifications";

// Only orders whose status can actually be overdue under
// lib/orders/overdue-rules.js — see getOrderOverdueReason for the mapping.
const CANDIDATE_STATUSES = ["PENDING_PICKUP", "PAID", "PROCESSING", "READY_FOR_PICKUP", "SHIPPED"];

// Bounds how often the same order can re-notify: without this, every cron
// run (this endpoint can be called as often as the external scheduler
// likes) would create a fresh notification for every still-overdue order,
// flooding the bell with duplicates of something staff already saw.
const RENOTIFY_COOLDOWN_MS = 24 * 60 * 60 * 1000;

/**
 * For the /api/cron job runner: flags boutique orders stalled mid-fulfilment
 * (never prepared/shipped, ready but never collected, shipped but never
 * confirmed received) with an in-app notification to every active
 * OWNER/ADMIN. Never cancels, restocks, or e-mails the customer — purely a
 * "someone should look at this" nudge; see lib/orders/expire-stale-orders.js
 * for the separate, destructive PICKUP_ON_SITE hard-expiry pipeline.
 *
 * Deliberately kept out of any "use server" module — every export from a
 * "use server" file is a public, unauthenticated POST endpoint.
 */
export async function notifyStaleOrderFulfilment() {
  const now = new Date();

  const candidates = await prisma.order.findMany({
    where: { status: { in: CANDIDATE_STATUSES } },
    select: {
      id: true,
      orderNumber: true,
      fulfilmentMode: true,
      status: true,
      createdAt: true,
      readyForPickupAt: true,
      shippedAt: true,
      collectedAt: true,
      user: { select: { fullName: true } },
    },
  });

  const overdue = candidates
    .map((order) => ({ order, reason: getOrderOverdueReason(order, now) }))
    .filter(({ reason }) => reason !== null);

  if (overdue.length === 0) return { notifiedCount: 0 };

  const adminIds = await getSalonAdminNotificationRecipients();
  if (adminIds.length === 0) return { notifiedCount: 0 };

  const actionUrlByOrderId = new Map(overdue.map(({ order }) => [order.id, `/dashboard/boutique/orders/${order.id}`]));
  const cooldownStart = new Date(now.getTime() - RENOTIFY_COOLDOWN_MS);
  const recentlyNotified = await prisma.notification.findMany({
    where: {
      type: "ORDER_FULFILMENT_OVERDUE",
      actionUrl: { in: Array.from(actionUrlByOrderId.values()) },
      createdAt: { gte: cooldownStart },
    },
    select: { actionUrl: true },
  });
  const recentUrls = new Set(recentlyNotified.map((n) => n.actionUrl));

  const toNotify = overdue.filter(({ order }) => !recentUrls.has(actionUrlByOrderId.get(order.id)));
  if (toNotify.length === 0) return { notifiedCount: 0 };

  const inputs = toNotify.flatMap(({ order, reason }) =>
    adminIds.map((userId) =>
      buildOrderFulfilmentOverdueNotification({
        userId,
        orderId: order.id,
        orderNumber: order.orderNumber,
        customerName: order.user?.fullName,
        fulfilmentMode: order.fulfilmentMode,
        reason,
      })
    )
  );

  // createNotificationsBulk caps at 500 rows per call — chunk defensively so
  // an unusually large pile-up of stale orders can't throw and drop the
  // whole batch.
  const BATCH_SIZE = 500;
  for (let i = 0; i < inputs.length; i += BATCH_SIZE) {
    await createNotificationsBulk(inputs.slice(i, i + BATCH_SIZE));
  }

  return { notifiedCount: toNotify.length };
}
