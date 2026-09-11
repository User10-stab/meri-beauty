import { prisma } from "@/lib/prisma";
import { TILL_CASH_OPERATOR_EMAIL } from "@/lib/authorization";
import { openCashSessionInternal, closeCashSessionInternal } from "@/lib/cash-book/session-lifecycle";
import { computeSessionCashTotals } from "@/lib/cash-book/session-totals";
import { revalidateCaisseRoutes } from "@/lib/cash-book/revalidate-caisse";

/**
 * Daily auto-open (at the salon's opening time) / auto-close (always at
 * midnight, per the client's explicit choice — real sales still happen past
 * 10pm, so closing at the salon's *listed* closing time would cut them off)
 * for the Livre de caisse. Both run as the same till-operator account
 * (TILL_CASH_OPERATOR_EMAIL, see lib/authorization.js) a human would use —
 * that account already owns every cash movement in the book, see
 * isTillCashOperator.
 */

/** "YYYY-MM-DD" for a Date, in the Brussels calendar day — matches how closures are compared below. */
function brusselsDateOnly(date) {
  return date.toLocaleDateString("en-CA", { timeZone: "Europe/Brussels" });
}

/** WeekDay enum value ("MONDAY"..."SUNDAY") for a Date, in Brussels local time. */
function brusselsWeekday(date) {
  return new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Brussels", weekday: "long" })
    .format(date)
    .toUpperCase();
}

/** "HH:mm", zero-padded, in Brussels local time — same format SalonWorkingDay/SalonClosure store. */
function brusselsTimeHHmm(date) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Brussels",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

/**
 * Whether — and at what time — the till should auto-open today, per the
 * salon's weekly schedule and any exceptional closure covering today.
 *
 * @returns {Promise<{ shouldOpen: boolean, openingTime: string | null }>}
 */
export async function resolveTodaysOpeningTime(now = new Date()) {
  const salon = await prisma.salon.findUnique({
    where: { id: "main-salon" },
    include: { workingDays: true, closures: true },
  });
  if (!salon) return { shouldOpen: false, openingTime: null };

  const today = brusselsDateOnly(now);
  const closure = salon.closures.find((c) => {
    const start = brusselsDateOnly(c.startDate);
    const end = c.endDate ? brusselsDateOnly(c.endDate) : start;
    return today >= start && today <= end;
  });
  if (closure?.isFullDay) return { shouldOpen: false, openingTime: null };

  const weekday = brusselsWeekday(now);
  const workingDay = salon.workingDays.find((wd) => wd.day === weekday);
  if (!workingDay?.isOpen) return { shouldOpen: false, openingTime: null };

  // A partial-day closure overrides the weekly opening time when it sets one.
  const openingTime = (!closure?.isFullDay && closure?.openingTime) || workingDay.openingTime;
  if (!openingTime) return { shouldOpen: false, openingTime: null };

  return { shouldOpen: true, openingTime };
}

async function getTillOperatorUserId() {
  const operator = await prisma.user.findFirst({
    where: { email: { equals: TILL_CASH_OPERATOR_EMAIL, mode: "insensitive" } },
    select: { id: true },
  });
  return operator?.id ?? null;
}

/**
 * Same fallback chain as getSuggestedOpeningFloat (actions/dashboard/cash-sessions.js):
 * the previous closed session's counted total, or 0 if there is none yet.
 * Duplicated rather than imported since that export lives in a "use server"
 * action file gated by a request-scoped auth() session this job doesn't have.
 */
async function suggestedOpeningFloat() {
  const lastClosed = await prisma.cashSession.findFirst({
    where: { closedAt: { not: null } },
    orderBy: { closedAt: "desc" },
    select: { countedCash: true },
  });
  return lastClosed?.countedCash == null ? 0 : Number(lastClosed.countedCash);
}

/**
 * Opens today's till session once the salon's opening time has passed, if
 * one isn't already open. Runs on the daily-cooldown tick in
 * lib/background-jobs.js — the cooldown alone only guarantees "not already
 * run today", so the opening-time check here still has to gate "not too
 * early" on every tick.
 */
export async function autoOpenCashSession(now = new Date()) {
  const { shouldOpen, openingTime } = await resolveTodaysOpeningTime(now);
  if (!shouldOpen) return { skipped: "closed" };
  if (brusselsTimeHHmm(now) < openingTime) return { skipped: "not-yet-opening-time" };

  const alreadyOpen = await prisma.cashSession.findFirst({ where: { closedAt: null }, select: { id: true } });
  if (alreadyOpen) return { skipped: "already-open" };

  const operatorId = await getTillOperatorUserId();
  if (!operatorId) return { skipped: "no-till-operator-account" };

  const openingFloat = await suggestedOpeningFloat();
  const session = await openCashSessionInternal(prisma, {
    userId: operatorId,
    openingFloat,
    isAutoOpened: true,
  }).catch((err) => {
    if (err.message === "CASH_SESSION_ALREADY_OPEN") return null;
    throw err;
  });
  if (!session) return { skipped: "already-open" };

  revalidateCaisseRoutes();
  return { opened: true, sessionId: session.id, openingFloat };
}

/**
 * Closes whatever till session is currently open, always at midnight
 * regardless of the salon's listed closing time (real sales happen past
 * 10pm — closing on the dot would cut them off). Nobody is physically at
 * the till at midnight to count it, so countedCash is set equal to
 * expectedCash (variance forced to 0): a pure day-boundary, not a real
 * count. The balance carries forward untouched into tomorrow's auto-open.
 * Real physical verification is the separate, optional
 * verifyCashSessionBalance action (actions/dashboard/cash-session-verification.js).
 */
export async function autoCloseCashSession() {
  const open = await prisma.cashSession.findFirst({ where: { closedAt: null } });
  if (!open) return { skipped: "no-open-session" };

  const operatorId = await getTillOperatorUserId();
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
