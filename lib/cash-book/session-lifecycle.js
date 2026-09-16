import { Prisma } from "@prisma/client";
import { computeCashVariance } from "@/lib/cash-sessions";
import { computeSessionCashTotals } from "@/lib/cash-book/session-totals";
import { TILL_CASH_OPERATOR_EMAIL } from "@/lib/authorization";

/**
 * The transactional bodies of open/close, extracted out of the "use server"
 * actions/dashboard/cash-sessions.js so the daily auto-open/auto-close job
 * (lib/cash-book/auto-session.js) can run the exact same logic without a
 * request-scoped auth() session — a cron tick has no logged-in user, only
 * the till-operator account it acts as on their behalf.
 *
 * Deliberately NOT a "use server" file itself: Next.js silently strips any
 * export that isn't an async server action from such a file, which would
 * make these internal helpers unreachable from a plain module (the same
 * trap documented in lib/livre-de-recettes/filters.js).
 */

export const SESSION_INCLUDE = {
  openedBy: { select: { id: true, fullName: true } },
  closedBy: { select: { id: true, fullName: true } },
  verifiedBy: { select: { id: true, fullName: true } },
};

/**
 * Opens a new till session as `userId`. Race-safe: an advisory lock
 * serializes concurrent opens (two staff members, or a double-click, both
 * racing a "no open session" read) so exactly one session ever gets created.
 * Throws "CASH_SESSION_ALREADY_OPEN" if one is already open.
 */
export async function openCashSessionInternal(prisma, { userId, openingFloat, isAutoOpened = false }) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext('cash-session-open'))`);

    const existing = await tx.cashSession.findFirst({ where: { closedAt: null } });
    if (existing) {
      throw new Error("CASH_SESSION_ALREADY_OPEN");
    }

    return tx.cashSession.create({
      data: {
        openedById: userId,
        openingFloat: Math.round(Number(openingFloat) * 100) / 100,
        isAutoOpened,
      },
      include: SESSION_INCLUDE,
    });
  });
}

/**
 * Closes `sessionId` as `userId` with the given counted amount. Atomic claim
 * gated on `closedAt: null` so a double-submit (or, for the auto-close job,
 * a late-running duplicate tick) can never close the same session twice.
 * Returns null if the session is missing or already closed.
 */
export async function closeCashSessionInternal(prisma, { sessionId, userId, countedCash, isAutoClosed = false }) {
  const session = await prisma.cashSession.findUnique({ where: { id: sessionId } });
  if (!session || session.closedAt) return null;

  const { cashIn, cashOut, movementsIn, movementsOut } = await computeSessionCashTotals(
    prisma,
    sessionId,
    session.openingFloat
  );
  const { expectedCash, countedCash: roundedCounted, variance } = computeCashVariance({
    openingFloat: session.openingFloat,
    cashIn,
    cashOut,
    movementsIn,
    movementsOut,
    counted: countedCash,
  });

  const claim = await prisma.cashSession.updateMany({
    where: { id: sessionId, closedAt: null },
    data: {
      closedAt: new Date(),
      closedById: userId,
      expectedCash,
      countedCash: roundedCounted,
      variance,
      isAutoClosed,
    },
  });
  if (claim.count === 0) return null;

  return prisma.cashSession.findUnique({ where: { id: sessionId }, include: SESSION_INCLUDE });
}

/**
 * The account credited as openedById/closedById for every automated
 * open/close — the daily cron (lib/cash-book/auto-session.js) and
 * ensureCashSessionOpen below both act as this account, never as whichever
 * staff member happened to trigger the check.
 */
export async function getTillOperatorUserId(prisma) {
  const operator = await prisma.user.findFirst({
    where: { email: { equals: TILL_CASH_OPERATOR_EMAIL, mode: "insensitive" } },
    select: { id: true },
  });
  return operator?.id ?? null;
}

/**
 * The previous closed session's counted total, or null if there has never
 * been one. The shared fallback chain getSuggestedOpeningFloat
 * (actions/dashboard/cash-sessions.js), autoOpenCashSession
 * (lib/cash-book/auto-session.js) and ensureCashSessionOpen below all carry
 * forward — a fresh till starts from what the till actually held last, not
 * from zero.
 */
export async function getLastClosedCountedCash(prisma) {
  const lastClosed = await prisma.cashSession.findFirst({
    where: { closedAt: { not: null } },
    orderBy: { closedAt: "desc" },
    select: { countedCash: true },
  });
  return lastClosed?.countedCash == null ? null : Number(lastClosed.countedCash);
}

/**
 * Opens today's till the instant the first cash-taking action of the day
 * actually needs one, instead of leaving that to the cron's polling
 * interval (autoOpenCashSession, which still runs independently and stays
 * the only thing that opens the till on quiet mornings with no sale yet).
 *
 * Only auto-opens when the carried-forward float is a usable positive
 * amount. At exactly 0 (a brand-new till, or last night's count genuinely
 * landed on nothing) or negative, a human has to look at that number before
 * money starts moving again — this returns null and every caller falls back
 * to its existing manual "Ouvrir la caisse" prompt instead.
 */
export async function ensureCashSessionOpen(prisma) {
  const existing = await prisma.cashSession.findFirst({ where: { closedAt: null }, select: { id: true } });
  if (existing) return existing;

  const suggested = await getLastClosedCountedCash(prisma);
  if (suggested == null || suggested <= 0) return null;

  const operatorId = await getTillOperatorUserId(prisma);
  if (!operatorId) return null;

  const opened = await openCashSessionInternal(prisma, {
    userId: operatorId,
    openingFloat: suggested,
    isAutoOpened: true,
  }).catch((err) => {
    if (err.message === "CASH_SESSION_ALREADY_OPEN") return null;
    throw err;
  });
  if (opened) return opened;

  // Lost the race to a concurrent auto-open (the cron tick, or another
  // transaction's own ensureCashSessionOpen call) — whatever it opened with
  // is exactly as valid as what this call would have opened with.
  return prisma.cashSession.findFirst({ where: { closedAt: null }, select: { id: true } });
}
