"use server";

import { stripe } from "@/lib/stripe";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

/**
 * Creates a Stripe Express Dashboard login link for the connected account.
 * This allows users to access their Stripe Express Dashboard to manage their account.
 *
 * @returns {Promise<{
 *   success: boolean,
 *   data?: { url: string },
 *   message?: string
 * }>}
 */
export async function createLoginLink() {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return { success: false, message: "Authentification requise." };
    }

    const staff = await prisma.staff.findUnique({
      where: { userId: session.user.id },
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
