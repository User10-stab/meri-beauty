"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { isAdminRole, ROLES } from "@/lib/authorization";
import { buildLiveStripePayload } from "@/lib/stripe-connect-status";
import { fetchLiveStripeStatus } from "./_fetch-live-status";

/**
 * Live Stripe snapshot for ONE staff member's Express account.
 *
 * Unlike getStripeAccountsForAdmin() (fast DB cache for the whole table),
 * this action reads the REAL state from Stripe — one batched call
 * (`accounts.retrieve` + `accounts.retrieveCapability("card_payments")`)
 * so the admin/staff sees the true capability (`status`, `requested`,
 * `requested_at`) and the live requirements (`currently_due` / `past_due` /
 * `errors` / `pending_verification` / `disabled_reason`) plus the general
 * account level (`charges_enabled`, `payouts_enabled`, `capabilities`).
 * Stripe stays the source of truth — nothing is persisted here (use
 * refreshStripeStatus() when the cache needs syncing).
 *
 * Authorization: OWNER/ADMIN may query any staffId (read-only status stays
 * visible even when the member revoked `allowAdminStripeAccess` — the
 * write actions keep enforcing that flag separately).
 * STAFF may only query their own row.
 *
 * @param {string} staffId
 * @returns {Promise<{ success: boolean, data?: object, message?: string }>}
 */
export async function getStripeAccountDetails(staffId) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return { success: false, message: "Authentification requise." };
    }

    if (!staffId) {
      return { success: false, message: "L'identifiant du staff est requis." };
    }

    const role = session.user.role;
    if (!isAdminRole(role)) {
      if (role !== ROLES.STAFF) {
        return { success: false, message: "Accès réservé au personnel." };
      }
      const own = await prisma.staff.findUnique({
        where: { userId: session.user.id },
        select: { id: true },
      });
      if (!own || own.id !== staffId) {
        return { success: false, message: "Vous n'avez pas accès à cette page." };
      }
    }

    const staff = await prisma.staff.findUnique({
      where: { id: staffId },
      select: { id: true, stripeAccountId: true, isDeleted: true },
    });

    if (!staff || staff.isDeleted) {
      return { success: false, message: "Staff introuvable." };
    }

    if (!staff.stripeAccountId) {
      return {
        success: false,
        connected: false,
        message: "Ce membre du staff n'a pas encore de compte Stripe.",
      };
    }

    const { account, capability } = await fetchLiveStripeStatus(staff.stripeAccountId);

    return {
      success: true,
      data: buildLiveStripePayload({
        staffId: staff.id,
        stripeAccountId: staff.stripeAccountId,
        account,
        capability,
      }),
    };
  } catch (error) {
    console.error("[getStripeAccountDetails]", error);
    if (error?.type === "StripeInvalidRequestError") {
      return { success: false, message: `Erreur Stripe : ${error.message}` };
    }
    return {
      success: false,
      message: "Erreur lors de la récupération du statut Stripe.",
    };
  }
}
