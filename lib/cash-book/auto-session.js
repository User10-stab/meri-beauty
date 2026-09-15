import { prisma } from "@/lib/prisma";
import { closeCashSessionInternal, getTillOperatorUserId } from "@/lib/cash-book/session-lifecycle";
import { computeSessionCashTotals } from "@/lib/cash-book/session-totals";
import { revalidateCaisseRoutes } from "@/lib/cash-book/revalidate-caisse";

/**
 * Daily auto-close for the Livre de caisse — always at midnight, per the
 * client's explicit choice: real sales still happen past 10pm, so closing at
 * the salon's *listed* closing time would cut them off. Runs as the
 * till-operator account (TILL_CASH_OPERATOR_EMAIL, see lib/authorization.js)
 * a human would use — that account already owns every cash movement in the
 * book, see isTillCashOperator.
 *
 * There is deliberately no scheduled auto-OPEN counterpart. The till opens
 * on the first cash-taking action of the day and not a moment before — see
 * ensureCashSessionOpen in lib/cash-book/session-lifecycle.js, which every
 * such action already calls. A till that opens on a timer books a "Solde
 * initial" on days nobody ever paid in cash, which is what the client
 * described as wrong.
 */

/** "YYYY-MM-DD" for a Date, in the Brussels calendar day — matches how closures are compared below. */
function brusselsDateOnly(date) {
  return date.toLocaleDateString("en-CA", { timeZone: "Europe/Brussels" });
}

/**
 * Closes whatever till session is currently open, always at midnight
 * regardless of the salon's listed closing time (real sales happen past
 * 10pm — closing on the dot would cut them off). Nobody is physically at
 * the till at midnight to count it, so countedCash is set equal to
 * expectedCash (variance forced to 0): a pure day-boundary, not a real
 * count. The balance carries forward untouched to the next sale, which
 * opens the till through ensureCashSessionOpen.
 *
 * The day check below is the real gate, not the scheduler's cooldown. This
 * used to close whatever was open at any hour and lean entirely on a 24h
 * in-memory cooldown in lib/background-jobs.js — which resets on every
 * process restart, and stopped being recorded at all once
 * revalidateCaisseRoutes began throwing. Paired with the scheduled
 * auto-open, that produced a session opened and closed within the same
 * second, every 5 minutes: 52 empty sessions and +702 € of phantom "Solde
 * initial" rows on 15/09/2026. A session may now only be closed once the
 * Brussels day it was opened on is genuinely over, so the worst a broken
 * cooldown can cause is a redundant no-op.
 */
export async function autoCloseCashSession(now = new Date()) {
  const open = await prisma.cashSession.findFirst({ where: { closedAt: null } });
  if (!open) return { skipped: "no-open-session" };
  if (brusselsDateOnly(open.openedAt) === brusselsDateOnly(now)) {
    return { skipped: "still-the-same-day" };
  }

  const operatorId = await getTillOperatorUserId(prisma);
  if (!operatorId) return { skipped: "no-till-operator-account" };

  const { expectedCash } = await computeSessionCashTotals(prisma, open.id, open.openingFloat);
  const closed = await closeCashSessionInternal(prisma, {
    sessionId: open.id,
    userId: operatorId,
    countedCash: expectedCash,
    isAutoClosed: true,
  });
  if (!closed) return { skipped: "already-closed" };

  revalidateCaisseRoutes();
  return { closed: true, sessionId: open.id, expectedCash };
}
