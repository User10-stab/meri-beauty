"use server";

import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { hasDashboardPermission, STAFF_PERMISSIONS } from "@/lib/authorization";
import { buildCashBookLedger } from "@/lib/cash-book/build-ledger";
import { buildRangeReport } from "@/lib/cash-book/build-day-report";
import { normalizeCashBookParams } from "@/lib/cash-book/filters";

async function requireCashBookAccess() {
  const session = await auth();
  if (!session?.user) return { error: "Non authentifié." };
  if (!(await hasDashboardPermission(session.user, STAFF_PERMISSIONS.CASH_REGISTER))) {
    return { error: "Accès non autorisé." };
  }
  return { session };
}

/** The Livre de caisse ledger over an arbitrary date range — see lib/cash-book/build-ledger.js. */
export async function getCashBookLedger({ from, to } = {}) {
  const guard = await requireCashBookAccess();
  if (guard.error) return { success: false, message: guard.error, data: null };

  const params = normalizeCashBookParams({ from, to });
  const ledger = await buildCashBookLedger(prisma, params);

  return { success: true, data: { ...ledger, filters: params } };
}

/** The "Rapport" — every payment method's revenue plus the cash reconciliation, over the same range. */
export async function getCashReport({ from, to } = {}) {
  const guard = await requireCashBookAccess();
  if (guard.error) return { success: false, message: guard.error, data: null };

  const params = normalizeCashBookParams({ from, to });
  const report = await buildRangeReport(prisma, params);

  return { success: true, data: { ...report, filters: params } };
}
