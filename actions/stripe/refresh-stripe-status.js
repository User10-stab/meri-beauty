"use server";

import { stripe } from "@/lib/stripe";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

/**
 * Fetches the latest Stripe account status directly from the Stripe API
 * and updates the local database with the latest charges_enabled and
 * payouts_enabled values.
 *
 * @returns {Promise<{
 *   success: boolean,
 *   data?: {
 *     chargesEnabled: boolean,
 *     payoutsEnabled: boolean,
 *     detailsSubmitted: boolean,
 *     currentlyDue: string[],
 *   },
 *   message?: string
 * }>}
 */
export async function refreshStripeStatus() {
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

    // ── Retrieve the latest account data from Stripe ──────────────────
    const account = await stripe.accounts.retrieve(staff.stripeAccountId);

    const chargesEnabled = account.charges_enabled ?? false;
    const payoutsEnabled = account.payouts_enabled ?? false;
    const detailsSubmitted = account.details_submitted ?? false;
    const currentlyDue = account.requirements?.currently_due ?? [];

    // ── Update the database with the latest values ────────────────────
    await prisma.staff.update({
      where: { id: staff.id },
      data: {
        stripeAccountType: account.type,
        stripeChargesEnabled: chargesEnabled,
        stripePayoutsEnabled: payoutsEnabled,
      },
    });

    return {
      success: true,
      data: {
        accountType: account.type,
        chargesEnabled,
        payoutsEnabled,
        detailsSubmitted,
        currentlyDue,
      },
    };
  } catch (error) {
    console.error("[refreshStripeStatus]", error);

    if (error.type === "StripeInvalidRequestError") {
      return {
        success: false,
        message: `Erreur Stripe : ${error.message}`,
      };
    }

    return {
      success: false,
      message: "Erreur lors de la récupération du statut Stripe.",
    };
  }
}