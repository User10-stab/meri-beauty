"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { isAdminRole } from "@/lib/authorization";
import { buildLiveStripePayload } from "@/lib/stripe-connect-status";
import { fetchLiveStripeStatus } from "./_fetch-live-status";

/**
 * Live Stripe snapshots for MANY staff Express accounts in one round trip.
 *
 * Used by the admin "Comptes Stripe" table so live statuses load
 * automatically when the page opens — no "Vérifier" click per row.
 * Stripe calls run in parallel server-side (allSettled: one account failing
 * never blocks the others). Nothing is persisted — Stripe stays the source
 * of truth, use refreshStripeStatus() when the DB cache needs syncing.
 *
 * Authorization: OWNER/ADMIN only. Read-only, so — like
 * getStripeAccountDetails() — no `allowAdminStripeAccess` gate: the write
 * actions (request, onboarding links) keep enforcing that flag separately.
 *
 * @param {string[]} staffIds - staff rows to snapshot (deduplicated, capped)
 * @returns {Promise<{ success: boolean, results?: Array<{ staffId: string, success: boolean, data?: object, connected?: boolean, message?: string }>, message?: string }>}
 */
const MAX_IDS = 100;

export async function getStripeAccountsLiveStatus(staffIds) {
  try {
    const session = await auth();
    if (!session?.user || !isAdminRole(session.user.role)) {
      return { success: false, results: [], message: "Permissions insuffisantes" };
    }

    const ids = [...new Set((staffIds ?? []).filter(Boolean))].slice(0, MAX_IDS);
    if (ids.length === 0) {
      return { success: true, results: [] };
    }

    const staffList = await prisma.staff.findMany({
      where: { id: { in: ids } },
      select: { id: true, stripeAccountId: true, isDeleted: true },
    });
    const byId = new Map(staffList.map((s) => [s.id, s]));

    const settled = await Promise.allSettled(
      ids.map(async (staffId) => {
        const staff = byId.get(staffId);
        if (!staff || staff.isDeleted) {
          return { staffId, success: false, message: "Staff introuvable." };
        }
        if (!staff.stripeAccountId) {
          return {
            staffId,
            success: false,
            connected: false,
            message: "Ce membre du staff n'a pas encore de compte Stripe.",
          };
        }
        const { account, capability } = await fetchLiveStripeStatus(staff.stripeAccountId);
        return {
          staffId,
          success: true,
          data: buildLiveStripePayload({
            staffId: staff.id,
            stripeAccountId: staff.stripeAccountId,
            account,
            capability,
          }),
        };
      })
    );

    return {
      success: true,
      results: settled.map((r, i) =>
        r.status === "fulfilled"
          ? r.value
          : {
              staffId: ids[i],
              success: false,
              message:
                r.reason?.type === "StripeInvalidRequestError"
                  ? `Erreur Stripe : ${r.reason.message}`
                  : "Erreur lors de la récupération du statut Stripe.",
            }
      ),
    };
  } catch (error) {
    console.error("[getStripeAccountsLiveStatus]", error);
    return {
      success: false,
      results: [],
      message: "Impossible de charger les statuts Stripe.",
    };
  }
}
