"use server";

import { revalidateCaisseRoutes } from "@/lib/cash-book/revalidate-caisse";
import { Prisma } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { hasDashboardPermission, STAFF_PERMISSIONS } from "@/lib/authorization";
import { allocatePieceNumber, seriesForMovementType } from "@/lib/cash-book/piece-number";
import { computeSessionCashTotals } from "@/lib/cash-book/session-totals";

/**
 * Money entering or leaving the drawer without being a sale or a refund:
 * paying a supplier out of the till, topping the float up mid-service,
 * dropping the takings into the safe.
 *
 * Same permission as the till itself — whoever runs the register is who
 * takes the twenty euros out for the delivery man.
 */
async function requireCashMovementAccess() {
  const session = await auth();
  if (!session?.user) return { error: "Non authentifié." };
  if (!(await hasDashboardPermission(session.user, STAFF_PERMISSIONS.CASH_REGISTER))) {
    return { error: "Accès non autorisé." };
  }
  return { session };
}

const MOVEMENT_TYPES = new Set(["EXPENSE", "CASH_IN", "WITHDRAWAL"]);

const MOVEMENT_INCLUDE = {
  recordedBy: { select: { id: true, fullName: true } },
};

function serializeCashMovement(movement) {
  return {
    id: movement.id,
    cashSessionId: movement.cashSessionId,
    type: movement.type,
    amount: Number(movement.amount),
    label: movement.label,
    pieceNumber: movement.pieceNumber,
    occurredAt: movement.occurredAt,
    recordedBy: movement.recordedBy
      ? { id: movement.recordedBy.id, fullName: movement.recordedBy.fullName }
      : null,
  };
}

/**
 * Records one drawer movement against the currently open session.
 *
 * Deliberately refuses when no session is open, unlike a sale — which is
 * never blocked by a closed till and is simply left unassigned. A sale is a
 * fact about the customer that happened regardless; a drawer movement is a
 * fact about a drawer, and recording that money left a till nobody opened
 * would be recording nothing at all.
 */
export async function recordCashMovement({ type, amount, label, occurredAt = null }) {
  const guard = await requireCashMovementAccess();
  if (guard.error) return { success: false, message: guard.error };

  if (!MOVEMENT_TYPES.has(type)) {
    return { success: false, message: "Type de mouvement invalide." };
  }

  // Stored unsigned — `type` alone carries the direction (see model
  // CashMovement), so a negative here would silently invert the day.
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) {
    return { success: false, message: "Le montant doit être un nombre strictement positif." };
  }
  const rounded = Math.round(value * 100) / 100;

  const trimmedLabel = typeof label === "string" ? label.trim() : "";
  if (!trimmedLabel) {
    return { success: false, message: "Indiquez un motif — c'est la seule justification de ce mouvement dans le livre de caisse." };
  }
  if (trimmedLabel.length > 200) {
    return { success: false, message: "Le motif ne peut pas dépasser 200 caractères." };
  }

  const when = occurredAt ? new Date(occurredAt) : new Date();
  if (Number.isNaN(when.getTime())) {
    return { success: false, message: "Date du mouvement invalide." };
  }

  let outcome;
  try {
    outcome = await prisma.$transaction(async (tx) => {
      // Serializes the read-balance-then-write below against a concurrent
      // movement on the same till: without it, two withdrawals can each read
      // a balance that covers them and together overdraw the drawer. Same
      // mechanism openCashSession uses for its own read-then-decide step.
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext('cash-movement'))`);

      const session = await tx.cashSession.findFirst({
        where: { closedAt: null },
        orderBy: { openedAt: "desc" },
      });
      if (!session) return { error: "Aucune session de caisse ouverte. Ouvrez la caisse avant d'enregistrer un mouvement." };

      // A movement dated before the till opened would sit above the opening
      // float in the book, i.e. before the balance it is supposed to move.
      if (when < session.openedAt) {
        return { error: "Le mouvement ne peut pas être antérieur à l'ouverture de la caisse." };
      }

      if (type !== "CASH_IN") {
        const { expectedCash } = await computeSessionCashTotals(tx, session.id, session.openingFloat);
        if (rounded > expectedCash) {
          return {
            error: `Impossible de sortir ${rounded.toFixed(2)} € : la caisse ne contient que ${expectedCash.toFixed(2)} €.`,
          };
        }
      }

      // Allocated inside the transaction so a rolled-back movement never
      // burns a number — a gap in the book is exactly what the series exists
      // to prevent (see lib/cash-book/piece-number.js).
      const pieceNumber = await allocatePieceNumber(tx, seriesForMovementType(type), when);

      const movement = await tx.cashMovement.create({
        data: {
          cashSessionId: session.id,
          type,
          amount: rounded,
          label: trimmedLabel,
          pieceNumber,
          occurredAt: when,
          recordedById: guard.session.user.id,
        },
        include: MOVEMENT_INCLUDE,
      });
      return { movement };
    });
  } catch (error) {
    // A unique-violation on pieceNumber means the counter and the table
    // disagree (a row inserted outside this path); surface it rather than
    // reporting a movement that was never written.
    if (error?.code === "P2002") {
      return { success: false, message: "Conflit de numérotation, réessayez." };
    }
    throw error;
  }

  if (outcome.error) return { success: false, message: outcome.error };

  revalidateCaisseRoutes();
  return { success: true, data: serializeCashMovement(outcome.movement) };
}

/** Every drawer movement of one session, in the order the money actually moved. */
export async function listCashMovements(sessionId) {
  const guard = await requireCashMovementAccess();
  if (guard.error) return { success: false, message: guard.error, data: [] };

  if (typeof sessionId !== "string" || !sessionId) {
    return { success: false, message: "Session de caisse introuvable.", data: [] };
  }

  const movements = await prisma.cashMovement.findMany({
    where: { cashSessionId: sessionId },
    orderBy: [{ occurredAt: "asc" }, { createdAt: "asc" }],
    include: MOVEMENT_INCLUDE,
  });
  return { success: true, data: movements.map(serializeCashMovement) };
}
