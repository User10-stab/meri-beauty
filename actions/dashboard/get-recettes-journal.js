"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { hasDashboardPermission, STAFF_PERMISSIONS } from "@/lib/authorization";
import { serializeDecimalFields } from "@/lib/serialize-prisma";
import { normalizeRecettesParams } from "@/lib/livre-de-recettes/filters";
import { buildRecettesJournal } from "@/lib/livre-de-recettes/build-recettes-journal";

/**
 * "Mes recettes": every payment the CALLER personally recorded over a date
 * range, across every method, with a running balance. Previously an
 * OWNER/ADMIN-only salon-wide register; now open to any STAFF member
 * granted STAFF_PERMISSIONS.MY_RECEIPTS, but scoped to their own recorded
 * transactions only — including for OWNER/ADMIN callers, nobody sees a
 * cross-staff or salon-wide total here any more (see build-recettes-journal.js).
 *
 * Every export of a "use server" file is a public endpoint in its own
 * right, so this re-checks the role and re-normalizes its params rather
 * than trusting the page that called it — a hand-edited query string must
 * not widen the window.
 *
 * @param {{ from?: string, to?: string, method?: string, category?: string }} [params]
 */
export async function getRecettesJournal(params = {}) {
  const session = await auth();
  if (!session?.user) return { success: false, message: "Non authentifié." };
  if (!(await hasDashboardPermission(session.user, STAFF_PERMISSIONS.MY_RECEIPTS))) {
    return { success: false, message: "Accès non autorisé." };
  }

  const normalized = normalizeRecettesParams(params);

  try {
    const data = await buildRecettesJournal(prisma, { ...normalized, actorId: session.user.id });
    return { success: true, data: serializeDecimalFields(data) };
  } catch (error) {
    console.error("[getRecettesJournal]", error);
    return { success: false, message: "Impossible de charger le livre de recettes." };
  }
}
