"use server";

import { stripe } from "@/lib/stripe";
import { prisma } from "@/lib/prisma";

/**
 * Generates a Stripe Account Link for onboarding a staff member's
 * Connect Express account.
 *
 * The action accepts a staffId (not a raw Stripe account ID) so it always
 * reads the stripeAccountId from the database. This prevents a client from
 * providing an arbitrary Stripe account ID they might have obtained elsewhere.
 *
 * Before generating the link, the action also verifies the account actually
 * exists on Stripe's side via stripe.accounts.retrieve().
 *
 * @param {string} staffId - The ID of the staff member
 * @returns {Promise<{ success: boolean, url?: string, message?: string }>}
 */
export async function createAccountLink(staffId) {
  try {
    if (!staffId) {
      return { success: false, message: "L'identifiant du staff est requis." };
    }

    // ── 1. Fetch staff record from the database ────────────────────────────
    const staff = await prisma.staff.findUnique({
      where: { id: staffId },
      select: { stripeAccountId: true },
    });

    if (!staff) {
      return { success: false, message: "Staff introuvable." };
    }

    if (!staff.stripeAccountId) {
      return {
        success: false,
        message:
          "Ce membre du staff n'a pas encore de compte Stripe. " +
          "Veuillez d'abord créer un compte Connect.",
      };
    }

    // ── 2. Verify the Stripe account exists and is valid ───────────────────
    // This catches deleted or invalid accounts before wasting a link generation.
    await stripe.accounts.retrieve(staff.stripeAccountId);

    // ── 3. Check required env vars ─────────────────────────────────────────
    const appUrl = process.env.NEXT_PUBLIC_APP_URL;

    if (!appUrl) {
      return { success: false, message: "L'URL de l'application n'est pas configurée." };
    }

    // ── 4. Generate the Account Link ───────────────────────────────────────
    const accountLink = await stripe.accountLinks.create({
      account: staff.stripeAccountId,
      refresh_url: `${appUrl}/dashboard/payments/onboarding?refresh=true`,
      return_url: `${appUrl}/dashboard/payments/onboarding?success=true`,
      type: "account_onboarding",
    });

    return {
      success: true,
      url: accountLink.url,
      message: "Lien d'onboarding Stripe généré avec succès.",
    };
  } catch (error) {
    console.error("[createAccountLink]", error);

    // Handle Stripe-specific errors
    if (error.type === "StripeInvalidRequestError") {
      return {
        success: false,
        message: `Erreur Stripe : ${error.message}`,
      };
    }

    return {
      success: false,
      message: "Erreur lors de la génération du lien d'onboarding Stripe.",
    };
  }
}