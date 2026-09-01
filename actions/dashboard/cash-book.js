"use server";

import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { hasDashboardPermission, STAFF_PERMISSIONS } from "@/lib/authorization";
import { buildCashBookLedger } from "@/lib/cash-book/build-ledger";
import { buildDayReport } from "@/lib/cash-book/build-day-report";

async function requireCashBookAccess() {
  const session = await auth();
  if (!session?.user) return { error: "Non authentifié." };
  if (!(await hasDashboardPermission(session.user, STAFF_PERMISSIONS.CASH_REGISTER))) {
    return { error: "Accès non autorisé." };
  }
  return { session };
}

/** The "livre de caisse" for one till session — same permission as the till itself. */
export async function getCashBookLedger(sessionId) {
  const guard = await requireCashBookAccess();
  if (guard.error) return { success: false, message: guard.error, data: null };

  if (typeof sessionId !== "string" || !sessionId) {
    return { success: false, message: "Session de caisse introuvable.", data: null };
  }

  const ledger = await buildCashBookLedger(prisma, sessionId);
  if (!ledger) return { success: false, message: "Session de caisse introuvable.", data: null };

  return { success: true, data: ledger };
}

/** The end-of-day report ("X" while open, "Z" once closed) for one till session. */
export async function getDayReport(sessionId) {
  const guard = await requireCashBookAccess();
  if (guard.error) return { success: false, message: guard.error, data: null };

  if (typeof sessionId !== "string" || !sessionId) {
    return { success: false, message: "Session de caisse introuvable.", data: null };
  }

  const report = await buildDayReport(prisma, sessionId);
  if (!report) return { success: false, message: "Session de caisse introuvable.", data: null };

  return { success: true, data: report };
}
