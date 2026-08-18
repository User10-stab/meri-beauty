"use server";

import { stripe } from "@/lib/stripe";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { ROLES, isAdminRole } from "@/lib/authorization";

/**
 * Creates a Stripe Connect Express account for a staff member.
 *
 * Authorization:
 * - STAFF       → may only create an account for themselves (staffId is
 *                 resolved from the session, the client value is ignored).
 * - ADMIN/OWNER → may pass any staffId (onboarding a staff member on their
 *                 behalf).
 * - CUSTOMER (or unauthenticated) → rejected.
 *
 * This action writes a brand-new Stripe account id onto a Staff row, so it
 * must not be callable by customers or by a staff member targeting another
 * staff's row — that would let an attacker link staff to Stripe accounts
 * they never requested.
 *
 * @param {string} staffId - The ID of the staff member (ignored for STAFF, who are auto-scoped)
 * @returns {Promise<{ success: boolean, stripeAccountId?: string, message?: string }>}
 */
export async function createConnectAccount(staffId) {
  try {
    // ── 0. Auth + role ──────────────────────────────────────────────────────
    const session = await auth();
    if (!session?.user) {
      return { success: false, message: "Authentification requise." };
    }

    // STAFF callers are auto-scoped to their own staff row; only
    // ADMIN/OWNER may target an arbitrary staffId.
    if (session.user.role === ROLES.STAFF) {
      const ownStaff = await prisma.staff.findUnique({
        where: { userId: session.user.id },
        select: { id: true },
      });
      if (!ownStaff) {
        return { success: false, message: "Aucun profil staff trouvé pour votre compte." };
      }
      staffId = ownStaff.id;
    } else if (!isAdminRole(session.user.role)) {
      return { success: false, message: "Accès réservé au personnel." };
    }

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
    const salon = await prisma.salon.findUnique({ where: { id: "main-salon" } });

    const account = await stripe.accounts.create({
  type: "express",
  country: "BE",
  email: staff.user.email,
  business_type: "individual",
  business_profile: {
     url: "https://meribeautystudio.com/",
  },
  metadata: {
    staffId: staff.id,
    userId: staff.userId,
  },
});
    // const account = await stripe.accounts.create({
    //   type: "express",
    //   email: staff.user.email,
    //   business_profile: {
    //     url: "https://meribeautystudio.com/",
    //   },
    //   company: {
    //     address: {
    //       line1: salon.address,
    //       city: "Jette",
    //       state: "Bruxelles",
    //       postal_code: 1000,
    //     },
    //   },
    //   metadata: {
    //     staffId: staff.id,
    //     userId: staff.userId,
    //   },
    // });

    // ── 4. Save the stripeAccountId to the Staff record ─────────────────────
    await prisma.staff.update({
      where: { id: staffId },
      data: {
        stripeAccountId: account.id,
        stripeAccountType: account.type,
      },
    });

    return {
      success: true,
      stripeAccountId: account.id,
      message: "Compte Stripe Connect Express créé avec succès.",
    };
  } catch (error) {
    console.error("[createConnectAccount]", error);

    // Stripe refuses account creation outright until the platform account has
    // signed up for Connect. That is a one-off dashboard action by the salon
    // owner, not something the staff member can fix — say so, instead of
    // showing them a generic failure they can only retry forever.
    const stripeMessage = error?.raw?.message ?? error?.message ?? "";
    if (stripeMessage.includes("signed up for Connect")) {
      return {
        success: false,
        message:
          "Stripe Connect n'est pas encore activé sur le compte du salon. " +
          "L'administrateur doit l'activer sur dashboard.stripe.com/connect avant que le staff puisse connecter un compte.",
      };
    }

    return {
      success: false,
      message: "Erreur lors de la création du compte Stripe Connect.",
    };
  }
}
