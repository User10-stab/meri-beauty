"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { resolveStripeTargetStaff } from "@/lib/stripe-view-as";

/**
 * Fetches the Stripe connection status for the authenticated staff member.
 *
 * @param {string|null} [viewStaffId] - When provided by an OWNER/ADMIN, loads
 *   THAT staff member's status instead (permission-gated in
 *   resolveStripeTargetStaff). Staff self calls omit it (existing behavior).
 * @returns {Promise<{
 *   success: boolean,
 *   data?: {
 *     stripeAccountId: string | null,
 *     stripeAccountType: string | null,
 *     stripeChargesEnabled: boolean,
 *     stripePayoutsEnabled: boolean,
 *     allowAdminStripeAccess: boolean,
 *   },
 *   message?: string
 * }>}
 */
export async function getStripeStatus(viewStaffId = null) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return { success: false, message: "Authentification requise." };
    }

    const resolved = await resolveStripeTargetStaff(session, viewStaffId);
    if (resolved.error) {
      return { success: false, message: resolved.error };
    }

    const staff = await prisma.staff.findUnique({
      where: { id: resolved.staffId },
      select: {
        id: true,
        stripeAccountId: true,
        stripeAccountType: true,
        stripeChargesEnabled: true,
        stripePayoutsEnabled: true,
        allowAdminStripeAccess: true,
      },
    });

    if (!staff) {
      return { success: false, message: "Aucun profil staff trouvé." };
    }

    return {
      success: true,
      data: {
        stripeAccountId: staff.stripeAccountId,
        stripeAccountType: staff.stripeAccountType,
        stripeChargesEnabled: staff.stripeChargesEnabled,
        stripePayoutsEnabled: staff.stripePayoutsEnabled,
        // Pre-migration rows default to true at the DB level; keep the
        // fallback so older data can never silently lock the admin out.
        allowAdminStripeAccess: staff.allowAdminStripeAccess ?? true,
      },
    };
  } catch (error) {
    console.error("[getStripeStatus]", error);
    return { success: false, message: "Erreur lors de la récupération du statut Stripe." };
  }
}