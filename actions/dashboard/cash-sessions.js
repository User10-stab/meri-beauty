"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { hasPermission, DASHBOARD_PERMISSIONS } from "@/lib/authorization";
import { computeCashVariance } from "@/lib/cash-sessions";

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
  if (!hasPermission(session.user.role, DASHBOARD_PERMISSIONS.ORDERS)) {
    return { error: "Accès non autorisé." };
  }
  return { session };
}

const SESSION_INCLUDE = {
  openedBy: { select: { id: true, fullName: true } },
  closedBy: { select: { id: true, fullName: true } },
};

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

  revalidatePath("/dashboard/caisse");
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

  // expected = opening float + CASH sales - CASH refunds recorded against
  // this session. A refund only ever hits the session it was issued
  // through, never the one it was originally sold under.
  const [cashIn, cashOut] = await Promise.all([
    prisma.transaction.aggregate({
      where: { cashSessionId: sessionId, method: "CASH", transactionType: { not: "REFUND" }, isDeleted: false },
      _sum: { amount: true },
    }),
    prisma.transaction.aggregate({
      where: { cashSessionId: sessionId, method: "CASH", transactionType: "REFUND", isDeleted: false },
      _sum: { amount: true },
    }),
  ]);
  const { expectedCash, countedCash: roundedCounted, variance } = computeCashVariance({
    openingFloat: session.openingFloat,
    cashIn: cashIn._sum.amount ?? 0,
    cashOut: cashOut._sum.amount ?? 0,
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

  const updated = await prisma.cashSession.findUnique({ where: { id: sessionId }, include: SESSION_INCLUDE });
  revalidatePath("/dashboard/caisse");
  return { success: true, data: serializeCashSession(updated) };
}

export async function listCashSessions({ page = 1, pageSize = 20 } = {}) {
  const guard = await requireCashSessionAccess();
  if (guard.error) return { success: false, message: guard.error, data: [], totalCount: 0, page, pageSize };

  const [totalCount, sessions] = await Promise.all([
    prisma.cashSession.count(),
    prisma.cashSession.findMany({
      orderBy: { openedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: SESSION_INCLUDE,
    }),
  ]);

  return { success: true, data: sessions.map(serializeCashSession), totalCount, page, pageSize };
}
