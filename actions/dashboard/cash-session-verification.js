"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { isTillCashOperator, isAdminRole, hasDashboardPermission, STAFF_PERMISSIONS } from "@/lib/authorization";
import { computeSessionCashTotals } from "@/lib/cash-book/session-totals";
import { roundMoney } from "@/lib/tax-policy";
import { revalidateCaisseRoutes } from "@/lib/cash-book/revalidate-caisse";

/**
 * The optional manual recount, layered on top of auto-close's synthetic
 * "countedCash == expectedCash" figures (see lib/cash-book/auto-session.js).
 * Nobody is physically at the till at midnight, so auto-close can never
 * actually catch a real shortfall/overage — this is the one place that
 * still can, whenever Marie (or an admin) chooses to physically count the
 * drawer. Deliberately does NOT touch closedById/countedCash/variance: those
 * stay exactly what the close (auto or manual) recorded, so the two figures
 * never get confused with each other in the history.
 */
async function requireVerificationAccess() {
  const session = await auth();
  if (!session?.user) return { error: "Non authentifié." };
  const allowed =
    isTillCashOperator(session.user) ||
    isAdminRole(session.user.role) ||
    (await hasDashboardPermission(session.user, STAFF_PERMISSIONS.CASH_REGISTER));
  if (!allowed) return { error: "Accès non autorisé." };
  return { session };
}

export async function verifyCashSessionBalance({ sessionId, countedAmount, note = "" } = {}) {
  const guard = await requireVerificationAccess();
  if (guard.error) return { success: false, message: guard.error };

  if (typeof sessionId !== "string" || !sessionId) {
    return { success: false, message: "Session de caisse introuvable." };
  }

  const counted = Number(countedAmount);
  if (!Number.isFinite(counted) || counted < 0) {
    return { success: false, message: "Le montant compté doit être un montant positif ou nul." };
  }

  const session = await prisma.cashSession.findUnique({ where: { id: sessionId } });
  if (!session) return { success: false, message: "Session de caisse introuvable." };

  // A closed session already has expectedCash pinned at close time — reuse
  // it rather than recomputing, so a verification against an old session
  // can't silently disagree with what actually closed it (a later refund or
  // correction touching the same period must never change what a past
  // closure said the drawer held). An open session has no such figure yet,
  // so it's computed live, same as the close/withdrawal-guard code path.
  const expectedCash =
    session.expectedCash != null ? Number(session.expectedCash) : (await computeSessionCashTotals(prisma, sessionId, session.openingFloat)).expectedCash;

  const verifiedVariance = roundMoney(counted - expectedCash);

  const updated = await prisma.cashSession.update({
    where: { id: sessionId },
    data: {
      verifiedAt: new Date(),
      verifiedById: guard.session.user.id,
      verifiedVariance,
      verificationNote: note ? String(note).slice(0, 1000) : null,
    },
  });

  revalidateCaisseRoutes();
  return {
    success: true,
    data: {
      sessionId: updated.id,
      expectedCash,
      countedAmount: counted,
      verifiedVariance,
      verifiedAt: updated.verifiedAt,
    },
  };
}
