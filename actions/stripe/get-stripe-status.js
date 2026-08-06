"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

/**
 * Fetches the Stripe connection status for the authenticated staff member.
 *
 * @returns {Promise<{
 *   success: boolean,
 *   data?: {
 *     stripeAccountId: string | null,
 *     stripeAccountType: string | null,
 *     stripeChargesEnabled: boolean,
 *     stripePayoutsEnabled: boolean,
 *   },
 *   message?: string
 * }>}
 */
export async function getStripeStatus() {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return { success: false, message: "Authentification requise." };
    }

    const staff = await prisma.staff.findUnique({
      where: { userId: session.user.id },
      select: {
        id: true,
        stripeAccountId: true,
        stripeAccountType: true,
        stripeChargesEnabled: true,
        stripePayoutsEnabled: true,
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
      },
    };
  } catch (error) {
    console.error("[getStripeStatus]", error);
    return { success: false, message: "Erreur lors de la récupération du statut Stripe." };
  }
}