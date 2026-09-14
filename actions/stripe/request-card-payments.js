"use server";

import { stripe } from "@/lib/stripe";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { resolveStripeTargetStaff } from "@/lib/stripe-view-as";
import {
  getCardPaymentsStatus,
  getStripeAccountLevel,
} from "@/lib/stripe-connect-status";
import { fetchLiveStripeStatus } from "./_fetch-live-status";

/**
 * Sends the REAL `card_payments` capability request to Stripe for a staff
 * member's Express account (`accounts.update` with
 * `capabilities.card_payments.requested: true`), then reloads the live
 * state and returns it.
 *
 * This is a write action, so unlike the read-only getStripeAccountDetails()
 * it goes through resolveStripeTargetStaff(): an OWNER/ADMIN acting for
 * another member needs that member's explicit `allowAdminStripeAccess`
 * permission (same gate as createAccountLink / login links). STAFF callers
 * are auto-scoped to their own row (existing behavior).
 *
 * After the request the caller must re-render from `data`:
 *   - capability still not active → "Activation en cours", plus any
 *     requirements Stripe now reports (the member completes them through
 *     the existing Express onboarding flow — no second system);
 *   - already active → idempotent success, no duplicate request effect.
 *
 * Only the pre-existing cache columns are persisted — no card-capability
 * column is ever stored. Stripe stays the source of truth.
 *
 * @param {string|null} [viewStaffId] - staff target for OWNER/ADMIN view-as;
 *   omitted for staff self calls.
 * @returns {Promise<{ success: boolean, data?: object, message?: string }>}
 */
export async function requestCardPayments(viewStaffId = null) {
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
        message: "Ce membre du staff n'a pas encore de compte Stripe.",
      };
    }

    // ── 1. Live state before ──────────────────────────────────────────
    const before = await fetchLiveStripeStatus(staff.stripeAccountId);
    const beforeCard = getCardPaymentsStatus(before.account, before.capability);

    if (beforeCard.cardPayments === "active" && before.account.charges_enabled) {
      return {
        success: true,
        alreadyActive: true,
        data: buildPayload(staff, before.account, before.capability),
        message: "Les paiements par carte sont déjà activés sur ce compte.",
      };
    }

    // ── 2. Real capability request to Stripe ──────────────────────────
    await stripe.accounts.update(staff.stripeAccountId, {
      capabilities: { card_payments: { requested: true } },
    });

    // ── 3. Reload live state after ────────────────────────────────────
    const after = await fetchLiveStripeStatus(staff.stripeAccountId);
    const accountLevel = getStripeAccountLevel(after.account);
    const card = getCardPaymentsStatus(after.account, after.capability);

    // ── 4. Sync the pre-existing cache columns only ───────────────────
    await prisma.staff.update({
      where: { id: staff.id },
      data: {
        stripeAccountType: after.account.type,
        stripeChargesEnabled: card.chargesEnabled,
        stripePayoutsEnabled: card.payoutsEnabled,
      },
    });

    const message =
      card.level === "ready"
        ? "Les paiements par carte sont activés sur ce compte."
        : card.currentlyDue.length > 0 ||
            card.pastDue.length > 0 ||
            card.errors.length > 0
          ? "Demande envoyée. Stripe demande des informations complémentaires — le professionnel doit les compléter via le flow d'onboarding Express."
          : "Demande envoyée. Activation en cours de traitement par Stripe.";

    return {
      success: true,
      alreadyActive: false,
      data: {
        staffId: staff.id,
        stripeAccountId: staff.stripeAccountId,
        connected: true,
        accountType: after.account.type ?? null,
        accountLevel: accountLevel.accountLevel,
        accountLabel: accountLevel.label,
        ...card,
      },
      message,
    };
  } catch (error) {
    console.error("[requestCardPayments]", error);
    if (error?.type === "StripeInvalidRequestError") {
      return { success: false, message: `Erreur Stripe : ${error.message}` };
    }
    return {
      success: false,
      message: "Erreur lors de la demande d'activation des paiements par carte.",
    };
  }
}

function buildPayload(staff, account, capability) {
  const accountLevel = getStripeAccountLevel(account);
  const card = getCardPaymentsStatus(account, capability);
  return {
    staffId: staff.id,
    stripeAccountId: staff.stripeAccountId,
    connected: true,
    accountType: account.type ?? null,
    accountLevel: accountLevel.accountLevel,
    accountLabel: accountLevel.label,
    ...card,
  };
}
