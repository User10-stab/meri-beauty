"use server";

import { revalidateCaisseRoutes } from "@/lib/cash-book/revalidate-caisse";
import { Prisma } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { hasDashboardPermission, canAccessDashboard, STAFF_PERMISSIONS } from "@/lib/authorization";
import { computeCashVariance } from "@/lib/cash-sessions";
import { computeSessionCashTotals } from "@/lib/cash-book/session-totals";
import { sendReservationTicketsForSession } from "@/lib/cash-book/reservation-tickets";
import { captureError } from "@/lib/monitoring";

/**
 * A daily till open/close boundary. Before this, every CASH POS sale was
 * tracked individually (Transaction.cashReceived/changeGiven) but nothing
 * gave a running expected total or a counted-vs-expected reconciliation —
 * a shortfall was only findable by recounting every sale one by one.
 *
 * Same permission as the register itself (DASHBOARD_PERMISSIONS.ORDERS) —
 * whoever can run the till can open/close it.
 */
async function requireCashSessionAccess() {
  const session = await auth();
  if (!session?.user) return { error: "Non authentifié." };
  if (!(await hasDashboardPermission(session.user, STAFF_PERMISSIONS.CASH_REGISTER))) {
    return { error: "Accès non autorisé." };
  }
  return { session };
}

const SESSION_INCLUDE = {
  openedBy: { select: { id: true, fullName: true } },
  closedBy: { select: { id: true, fullName: true } },
};

/**
 * "Is any till session open" — deliberately open to any dashboard role
 * (staff or admin), unlike every other export here (CASH_REGISTER only).
 * Every counter-money path can now be blocked or warned by this (POS,
 * Pointage & encaissement settling a RDV/atelier/formation balance in cash),
 * and whoever holds APPOINTMENTS, WORKSHOP_RESERVATIONS,
 * FORMATION_RESERVATIONS, ORDERS or POINT_OF_SALE — not necessarily
 * CASH_REGISTER — needs the answer just as much as whoever can open/close
 * the till. Exposes only a boolean, nothing about who opened it or for how
 * much, so gating it any tighter than "is this a real dashboard user" buys
 * no actual protection while reintroducing the false-"closed" problem this
 * exists to avoid.
 */
export async function isCashSessionOpen() {
  const authSession = await auth();
  if (!authSession?.user || !canAccessDashboard(authSession.user.role)) {
    return { success: false, message: "Non authentifié.", data: false };
  }

  const session = await prisma.cashSession.findFirst({ where: { closedAt: null }, select: { id: true } });
  return { success: true, data: Boolean(session) };
}

function serializeCashSession(session) {
  return {
    id: session.id,
    openedAt: session.openedAt,
    openedBy: session.openedBy ? { id: session.openedBy.id, fullName: session.openedBy.fullName } : null,
    openingFloat: Number(session.openingFloat),
    closedAt: session.closedAt,
    closedBy: session.closedBy ? { id: session.closedBy.id, fullName: session.closedBy.fullName } : null,
    expectedCash: session.expectedCash == null ? null : Number(session.expectedCash),
    countedCash: session.countedCash == null ? null : Number(session.countedCash),
    variance: session.variance == null ? null : Number(session.variance),
    note: session.note,
  };
}

/** The currently open till session, if any — completePointOfSaleSale attaches new CASH transactions to it. */
export async function getCurrentCashSession() {
  const guard = await requireCashSessionAccess();
  if (guard.error) return { success: false, message: guard.error, data: null };

  const session = await prisma.cashSession.findFirst({
    where: { closedAt: null },
    orderBy: { openedAt: "desc" },
    include: SESSION_INCLUDE,
  });
  return { success: true, data: session ? serializeCashSession(session) : null };
}

/**
 * The opening float a fresh "Ouvrir la caisse" form should be pre-filled
 * with — the previous session's own counted total, same logic
 * CashSessionClient's lastCountedCash already applies from the full history
 * it has loaded. Exposed separately so any screen that can open a session
 * (the till page, or the POS blocking gate below) can pre-fill it without
 * fetching the whole session history first.
 */
export async function getSuggestedOpeningFloat() {
  const guard = await requireCashSessionAccess();
  if (guard.error) return { success: false, message: guard.error, data: null };

  const lastClosed = await prisma.cashSession.findFirst({
    where: { closedAt: { not: null } },
    orderBy: { closedAt: "desc" },
    select: { countedCash: true },
  });
  return { success: true, data: lastClosed?.countedCash == null ? null : Number(lastClosed.countedCash) };
}

export async function openCashSession(openingFloat) {
  const guard = await requireCashSessionAccess();
  if (guard.error) return { success: false, message: guard.error };

  const amount = Number(openingFloat);
  if (!Number.isFinite(amount) || amount < 0) {
    return { success: false, message: "Le fond de caisse doit être un montant positif ou nul." };
  }

  // Check-then-create on its own is a race: two concurrent calls (a
  // double-click, or two staff opening the till around the same moment)
  // can both read "no open session" before either commits, and both create
  // one — leaving two simultaneously-open sessions with no deterministic
  // way to say which CASH sales belong to which. The advisory lock
  // serializes this exactly like the refund-reconciliation code does for
  // its own "read then decide" step.
  const session = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext('cash-session-open'))`);

    const existing = await tx.cashSession.findFirst({ where: { closedAt: null } });
    if (existing) {
      throw new Error("CASH_SESSION_ALREADY_OPEN");
    }

    return tx.cashSession.create({
      data: { openedById: guard.session.user.id, openingFloat: Math.round(amount * 100) / 100 },
      include: SESSION_INCLUDE,
    });
  }).catch((err) => {
    if (err.message === "CASH_SESSION_ALREADY_OPEN") return null;
    throw err;
  });

  if (!session) {
    return { success: false, message: "Une session de caisse est déjà ouverte. Fermez-la avant d'en ouvrir une nouvelle." };
  }

  revalidateCaisseRoutes();
  return { success: true, data: serializeCashSession(session) };
}

export async function closeCashSession(sessionId, countedCash) {
  const guard = await requireCashSessionAccess();
  if (guard.error) return { success: false, message: guard.error };

  const counted = Number(countedCash);
  if (!Number.isFinite(counted) || counted < 0) {
    return { success: false, message: "Le montant compté doit être un montant positif ou nul." };
  }

  const session = await prisma.cashSession.findUnique({ where: { id: sessionId } });
  if (!session) return { success: false, message: "Session de caisse introuvable." };
  if (session.closedAt) return { success: false, message: "Cette session est déjà clôturée." };

  // Shared with the withdrawal guard and the X/Z day report — computing
  // "expected cash" three different ways is how a report ends up
  // contradicting the closure it describes. expected = opening float + CASH
  // sales - CASH refunds +/- non-sale drawer movements (see model
  // CashMovement).
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
    counted,
  });

  // Atomic claim, gated on still being open — a double-submit (double-click,
  // two tabs) can't close the same session twice and overwrite the first
  // closure's figures with a second count.
  const claim = await prisma.cashSession.updateMany({
    where: { id: sessionId, closedAt: null },
    data: {
      closedAt: new Date(),
      closedById: guard.session.user.id,
      expectedCash,
      countedCash: roundedCounted,
      variance,
    },
  });
  if (claim.count === 0) {
    return { success: false, message: "Cette session vient d'être clôturée par quelqu'un d'autre." };
  }

  // Ateliers/formations/rendez-vous already got their legal Invoice at
  // settlement time, but never the compact till-style ticket a customer
  // actually expects as a receipt — sent once here, in a single batch, now
  // that the session is definitively closed. Best-effort: a PDF or email
  // failure must never turn an already-committed till closure into an
  // error response.
  await sendReservationTicketsForSession(prisma, sessionId).catch((error) => {
    captureError(error, { area: "cash-book", context: "close-session-reservation-tickets", sessionId });
  });

  const updated = await prisma.cashSession.findUnique({ where: { id: sessionId }, include: SESSION_INCLUDE });
  revalidateCaisseRoutes();
  return { success: true, data: serializeCashSession(updated) };
}

/**
 * Till history, optionally windowed.
 *
 * `from`/`to` are calendar-day boundaries on openedAt: a till session is a
 * day's work, so filtering on when it was opened is what anyone reconciling a
 * month actually means. `to` is treated as inclusive of its whole day.
 *
 * The summary is computed over the WHOLE filtered range, not the current page
 * — a total that changed when you paged would be worse than no total.
 */
export async function listCashSessions({ page = 1, pageSize = 20, from = null, to = null } = {}) {
  const guard = await requireCashSessionAccess();
  if (guard.error) return { success: false, message: guard.error, data: [], totalCount: 0, page, pageSize, summary: null };

  const openedAt = {};
  const fromDate = from ? new Date(from) : null;
  const toDate = to ? new Date(to) : null;
  if (fromDate && !Number.isNaN(fromDate.getTime())) openedAt.gte = fromDate;
  if (toDate && !Number.isNaN(toDate.getTime())) {
    // Inclusive end: someone filtering "to 31 March" means through the 31st,
    // not up to its midnight, which would drop that whole day's sessions.
    toDate.setHours(23, 59, 59, 999);
    openedAt.lte = toDate;
  }
  const where = Object.keys(openedAt).length ? { openedAt } : {};

  const [totalCount, sessions, closedAgg, closedCount] = await Promise.all([
    prisma.cashSession.count({ where }),
    prisma.cashSession.findMany({
      where,
      orderBy: { openedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: SESSION_INCLUDE,
    }),
    // Only closed sessions carry expected/counted/variance; an open one has
    // nulls that would silently read as zeros in a total.
    prisma.cashSession.aggregate({
      where: { ...where, closedAt: { not: null } },
      _sum: { openingFloat: true, expectedCash: true, countedCash: true, variance: true },
    }),
    prisma.cashSession.count({ where: { ...where, closedAt: { not: null } } }),
  ]);

  return {
    success: true,
    data: sessions.map(serializeCashSession),
    totalCount,
    page,
    pageSize,
    summary: {
      closedCount,
      openingFloat: Number(closedAgg._sum.openingFloat ?? 0),
      expectedCash: Number(closedAgg._sum.expectedCash ?? 0),
      countedCash: Number(closedAgg._sum.countedCash ?? 0),
      variance: Number(closedAgg._sum.variance ?? 0),
    },
  };
}
