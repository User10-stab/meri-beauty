import { prisma } from "@/lib/prisma";
import { isAdminRole, ROLES } from "@/lib/authorization";

/**
 * Shared target-resolution for the Stripe payment-management flow.
 *
 * The `/dashboard/payments` page and every Stripe action behind it identify
 * the staff member the same way:
 *   - No override → the caller must be STAFF and is scoped to their own row
 *     (existing behavior, unchanged).
 *   - `viewStaffId` override → the caller must be OWNER/ADMIN AND the target
 *     staff member must have explicitly granted access via
 *     Staff.allowAdminStripeAccess (the "Donner la permission à
 *     l'administrateur…" toggle). Otherwise the override is rejected, so an
 *     admin can never accidentally — or deliberately — see or modify another
 *     account, including their own confusion with a staff member's.
 *
 * Centralising the gate here (instead of copying it into every action/route)
 * keeps the permission check identical everywhere.
 */
export const STAFF_STRIPE_ACCESS_DENIED = "Vous n'avez pas accès à cette page.";

/**
 * @param {object|null} session - auth() session (must contain user.id/role)
 * @param {string|null|undefined} viewStaffId - explicit staff target, if any
 * @returns {Promise<{ staffId: string } | { error: string }>}
 */
export async function resolveStripeTargetStaff(session, viewStaffId) {
  if (!session?.user?.id) {
    return { error: "Authentification requise." };
  }

  // ── Self mode (existing staff behavior) ───────────────────────────────
  if (!viewStaffId) {
    if (session.user.role !== ROLES.STAFF) {
      return { error: "Aucun profil staff trouvé." };
    }
    const own = await prisma.staff.findUnique({
      where: { userId: session.user.id },
      select: { id: true },
    });
    if (!own) {
      return { error: "Aucun profil staff trouvé." };
    }
    return { staffId: own.id };
  }

  // ── Admin view-as mode (permission-gated) ─────────────────────────────
  if (!isAdminRole(session.user.role)) {
    return { error: STAFF_STRIPE_ACCESS_DENIED };
  }

  const staff = await prisma.staff.findUnique({
    where: { id: viewStaffId },
    select: { id: true, isDeleted: true, allowAdminStripeAccess: true },
  });

  if (!staff || staff.isDeleted) {
    return { error: "Compte Stripe introuvable." };
  }

  if (staff.allowAdminStripeAccess !== true) {
    return { error: STAFF_STRIPE_ACCESS_DENIED };
  }

  return { staffId: staff.id };
}
