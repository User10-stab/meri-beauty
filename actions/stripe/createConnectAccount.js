"use server";

import { stripe } from "@/lib/stripe";
import { prisma } from "@/lib/prisma";

/**
 * Creates a Stripe Connect Express account for a staff member.
 *
 * This function:
 * 1. Validates the staff member exists
 * 2. Checks if a Stripe account already exists (idempotent)
 * 3. Creates a Stripe Connect Express account with the staff's info
 * 4. Saves the stripeAccountId to the Staff record
 * 5. Returns the account ID
 *
 * @param {string} staffId - The ID of the staff member
 * @returns {Promise<{ success: boolean, stripeAccountId?: string, message?: string }>}
 */
export async function createConnectAccount(staffId) {
  try {
    if (!staffId) {
      return { success: false, message: "L'identifiant du staff est requis." };
    }

    // ── 1. Find the staff member with user info ─────────────────────────────
    const staff = await prisma.staff.findUnique({
      where: { id: staffId },
      include: {
        user: {
          select: {
            fullName: true,
            email: true,
            phone: true,
          },
        },
      },
    });

    if (!staff) {
      return { success: false, message: "Staff introuvable." };
    }
    if(!staff.user.email) {
      return { success: false, message: "L'email du staff est requis." };
    }
    if(staff.isDeleted) {
      return { success: false, message: "Le staff est supprimé." };
    }
    if(!staff.isActive) {
      return { success: false, message: "Le staff n'est pas actif." };
    }

    // ── 2. Check if a Stripe account already exists ─────────────────────────
    // If the account already exists, return it rather than creating a duplicate.
    if (staff.stripeAccountId) {
      return {
        success: true,
        stripeAccountId: staff.stripeAccountId,
        message: "Un compte Stripe existe déjà pour ce membre du staff.",
      };
    }

    // ── 3. Create Stripe Connect Express account ────────────────────────────
    const account = await stripe.accounts.create({
      type: "express",
      email: staff.user.email,
      business_profile: {
        url: process.env.NEXT_PUBLIC_APP_URL,
      },
      company: {
        address: {
          line1: salon.address,
          city: "Jette",
          state: "Bruxelles",
          postal_code: 1000,
        },
      },
      metadata: {
        staffId: staff.id,
        userId: staff.userId,
      },
    });

    // ── 4. Save the stripeAccountId to the Staff record ─────────────────────
    await prisma.staff.update({
      where: { id: staffId },
      data: { stripeAccountId: account.id },
    });

    return {
      success: true,
      stripeAccountId: account.id,
      message: "Compte Stripe Connect Express créé avec succès.",
    };
  } catch (error) {
    console.error("[createConnectAccount]", error);
    return {
      success: false,
      message: "Erreur lors de la création du compte Stripe Connect.",
    };
  }
}