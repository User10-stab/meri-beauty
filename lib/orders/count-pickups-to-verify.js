import { prisma } from "@/lib/prisma";
import {
  ROLES,
  DASHBOARD_PERMISSIONS,
  STAFF_PERMISSIONS,
  canAccessStaffPermission,
} from "@/lib/authorization";

/**
 * How many expired on-site pickups are waiting for somebody to say whether
 * the customer actually came.
 *
 * This exists to put a number in the sidebar, and the sidebar is the point.
 * Holding an expired pickup's stock instead of guessing is the right call
 * (lib/orders/expire-stale-orders.js explains why), but it only works if the
 * worklist is actually worked — and "Commandes › Retraits à vérifier" is a
 * screen nobody opens unless they already know something is in it. The
 * staff e-mail fires once, at expiry, and is then just an old e-mail.
 *
 * So the count follows staff onto every dashboard page. Without it the whole
 * design rests on somebody remembering, and releaseUnverifiedPickups — the
 * 14-day backstop — stops being a backstop and becomes the normal path.
 *
 * Deliberately not a "use server" export: every export from such a module is
 * a public POST endpoint, and this one is called on every dashboard render.
 *
 * @param {{ role?: string }} user
 * @param {string[]} grantedPermissions
 * @returns {Promise<number>} 0 for anyone who cannot see the orders screen —
 *   a badge for a page you are not allowed to open is noise, and the number
 *   itself (how much stock is in limbo) is not a staff-wide fact.
 */
export async function countPickupsToVerify(user, grantedPermissions = []) {
  const role = user?.role;
  if (!role) return 0;

  // The same two gates the "Commandes" nav item is filtered by, so the badge
  // cannot appear on an item that is not there.
  if (!DASHBOARD_PERMISSIONS.ORDERS.includes(role)) return 0;
  if (role === ROLES.STAFF && !canAccessStaffPermission(role, grantedPermissions, STAFF_PERMISSIONS.ORDERS)) {
    return 0;
  }

  // Same predicate as listPickupsToVerify (actions/boutique/orders.js): an
  // on-site pickup that expired and whose stock nobody has ruled on. If those
  // two ever diverge, the badge starts lying about the list.
  return prisma.order.count({
    where: { fulfilmentMode: "PICKUP_ON_SITE", status: "EXPIRED", stockReleasedAt: null },
  });
}
