"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { resolveStripeTargetStaff } from "@/lib/stripe-view-as";
import {
  getCardPaymentsStatus,
  getStripeAccountLevel,
} from "@/lib/stripe-connect-status";
import { fetchLiveStripeStatus } from "./_fetch-live-status";

/**
 * Fetches the latest Stripe account status directly from the Stripe API
 * and updates the local database with the latest charges_enabled and
 * payouts_enabled values.
 *
 * @param {string|null} [viewStaffId] - When provided by an OWNER/ADMIN,
 *   refreshes THAT staff member's account instead (permission-gated in
 *   resolveStripeTargetStaff). Staff self calls omit it (existing behavior).
 * @returns {Promise<{
 *   success: boolean,
 *   data?: {
 *     chargesEnabled: boolean,
 *     payoutsEnabled: boolean,
 *     detailsSubmitted: boolean,
 *     currentlyDue: string[],
 *     pastDue: string[],
 *     errors: Array<object>,
 *     pendingVerification: string[],
 *     disabledReason: string|null,
 *     cardPayments: string,
 *     cardRequested: boolean,
 *     cardRequestedAt: number|null,
 *     accountLevel: "active"|"limited"|"disabled",
 *     accountLabel: string,
 *     level: "ready"|"pending"|"action_required",
 *     canRequest: boolean,
 *     actionNeeded: boolean,
 *     label: string,
 *     detail: string,
 *   },
 *   message?: string
 * }>}
 */
export async function refreshStripeStatus(viewStaffId = null) {
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

    // ── Retrieve the latest account + REAL card_payments capability ──
    // One batched live read (shared fetcher — same call pattern as
    // getStripeAccountDetails, so refreshes never stack duplicate calls).
    const { account, capability } = await fetchLiveStripeStatus(staff.stripeAccountId);

    // Stripe stays the source of truth: the live capability +
    // requirements snapshot is derived via the shared helper and returned
    // to the caller. Only the pre-existing cache columns
    // (stripeAccountType/Charges/PayoutsEnabled) are persisted — no new DB
    // field is introduced.
    const accountLevel = getStripeAccountLevel(account);
    const live = getCardPaymentsStatus(account, capability);

    // ── Update the database with the latest values ────────────────────
    await prisma.staff.update({
      where: { id: staff.id },
      data: {
        stripeAccountType: account.type,
        stripeChargesEnabled: live.chargesEnabled,
        stripePayoutsEnabled: live.payoutsEnabled,
      },
    });

    return {
      success: true,
      data: {
        accountType: account.type,
        accountLevel: accountLevel.accountLevel,
        accountLabel: accountLevel.label,
        chargesEnabled: live.chargesEnabled,
        payoutsEnabled: live.payoutsEnabled,
        detailsSubmitted: live.detailsSubmitted,
        currentlyDue: live.currentlyDue,
        pastDue: live.pastDue,
        errors: live.errors,
        pendingVerification: live.pendingVerification,
        disabledReason: live.disabledReason,
        cardPayments: live.cardPayments,
        cardRequested: live.cardRequested,
        cardRequestedAt: live.cardRequestedAt,
        level: live.level,
        canRequest: live.canRequest,
        actionNeeded: live.actionNeeded,
        label: live.label,
        detail: live.detail,
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