"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { hasPermission, DASHBOARD_PERMISSIONS } from "@/lib/authorization";
import { serializeDecimalFields } from "@/lib/serialize-prisma";
import { normalizeRecettesParams } from "@/lib/livre-de-recettes/filters";
import { buildRecettesJournal } from "@/lib/livre-de-recettes/build-recettes-journal";

/**
 * The Livre de recettes: every payment received over a date range, across
 * every method, with a running balance. Salon-wide financial data spanning
 * online and card revenue, not just the till drawer — gated at the same
 * OWNER/ADMIN tier as Opérations and Rapports.
 *
 * Every export of a "use server" file is a public endpoint in its own
 * right, so this re-checks the role and re-normalizes its params rather
 * than trusting the page that called it — a hand-edited query string must
 * not widen the window.
 *
 * @param {{ from?: string, to?: string, method?: string, category?: string, staffId?: string }} [params]
 */
export async function getRecettesJournal(params = {}) {
  const session = await auth();
  if (!session?.user) return { success: false, message: "Non authentifié." };
  if (!hasPermission(session.user.role, DASHBOARD_PERMISSIONS.REPORTS)) {
    return { success: false, message: "Accès non autorisé." };
  }

  const normalized = normalizeRecettesParams(params);

  // Optional staff scope (dashboard revenue-card deep-link): validated here
  // — an unknown or deleted id is ignored rather than widening the journal.
  // This page is OWNER/ADMIN-only, so no per-staff ownership check applies.
  let staffName = null;
  if (normalized.staffId) {
    const target = await prisma.staff.findUnique({
      where: { id: normalized.staffId },
      select: { id: true, isDeleted: true, user: { select: { fullName: true } } },
    });
    if (target && !target.isDeleted) {
      staffName = target.user.fullName;
    } else {
      normalized.staffId = "";
    }
  }

  try {
    const data = await buildRecettesJournal(prisma, { ...normalized, staffName });
    return { success: true, data: serializeDecimalFields(data) };
  } catch (error) {
    console.error("[getRecettesJournal]", error);
    return { success: false, message: "Impossible de charger le livre de recettes." };
  }
}
