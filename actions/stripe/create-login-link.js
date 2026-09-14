"use server";

import { stripe } from "@/lib/stripe";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { resolveStripeTargetStaff } from "@/lib/stripe-view-as";

/**
 * Creates a Stripe Express Dashboard login link for the connected account.
 * This allows users to access their Stripe Express Dashboard to manage their account.
 *
 * @param {string|null} [viewStaffId] - When provided by an OWNER/ADMIN, creates
 *   the link for THAT staff member's account instead (permission-gated in
 *   resolveStripeTargetStaff). Staff self calls omit it (existing behavior).
 * @returns {Promise<{
 *   success: boolean,
 *   data?: { url: string },
 *   message?: string
 * }>}
 */
export async function createLoginLink(viewStaffId = null) {
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
      select: { id: true, stripeAccountId: true },
    });

    if (!staff) {
      return { success: false, message: "Aucun profil staff trouvé." };
    }

    if (!staff.stripeAccountId) {
      return {
        success: false,
        message: "Vous n'avez pas encore de compte Stripe.",
      };
    }

    // ── Create Express Dashboard login link ─────────────────────────────
    const loginLink = await stripe.accounts.createLoginLink(
      staff.stripeAccountId
    );

    return {
      success: true,
      data: {
        url: loginLink.url,
      },
    };
  } catch (error) {
    console.error("[createLoginLink]", error);

    if (error.type === "StripeInvalidRequestError") {
      return {
        success: false,
        message: `Erreur Stripe : ${error.message}`,
      };
    }

    return {
      success: false,
      message: "Erreur lors de la création du lien de connexion.",
    };
  }
}
