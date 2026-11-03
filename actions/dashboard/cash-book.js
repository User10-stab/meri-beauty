"use server";

import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { isTillCashOperator } from "@/lib/authorization";
import { buildCashBookLedger } from "@/lib/cash-book/build-ledger";
import { buildRangeReport } from "@/lib/cash-book/build-day-report";
import { normalizeCashBookParams, normalizeCashBookKind, applyCashBookKindFilter } from "@/lib/cash-book/filters";

async function requireCashBookAccess() {
  const session = await auth();
  if (!session?.user) return { error: "Non authentifié." };
  if (!isTillCashOperator(session.user)) {
    return { error: "Accès non autorisé." };
  }
  return { session };
}

/**
 * The Livre de caisse ledger over an arbitrary date range — see
 * lib/cash-book/build-ledger.js — optionally narrowed to apports/dépenses
 * (`type`, see CASH_BOOK_KIND_FILTERS in lib/cash-book/filters.js).
 */
export async function getCashBookLedger({ from, to, type } = {}) {
  const guard = await requireCashBookAccess();
  if (guard.error) return { success: false, message: guard.error, data: null };

  const params = normalizeCashBookParams({ from, to });
  const kind = normalizeCashBookKind(type);
  const ledger = applyCashBookKindFilter(await buildCashBookLedger(prisma, params), kind);

  return { success: true, data: { ...ledger, filters: { ...params, type: kind } } };
}

/** The "Rapport" — cash-only revenue (category + VAT) plus the cash reconciliation, over the same range. */
export async function getCashReport({ from, to } = {}) {
  const guard = await requireCashBookAccess();
  if (guard.error) return { success: false, message: guard.error, data: null };

  const params = normalizeCashBookParams({ from, to });
  const report = await buildRangeReport(prisma, params);

  return { success: true, data: { ...report, filters: params } };
}
