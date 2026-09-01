"use server";

import { revalidateCaisseRoutes } from "@/lib/cash-book/revalidate-caisse";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { hasDashboardPermission, STAFF_PERMISSIONS } from "@/lib/authorization";
import { roundMoney } from "@/lib/tax-policy";

/**
 * A withdrawal leaving the drawer (CashMovement WITHDRAWAL) and that cash
 * actually reaching the bank are two different facts separated by a trip
 * someone has to make — and that gap is exactly where money can go missing
 * without anyone being able to say so. This module is the second fact.
 *
 * Same permission as the till itself — whoever is trusted to run the
 * register is who walks the takings to the bank.
 */
async function requireBankDepositAccess() {
  const session = await auth();
  if (!session?.user) return { error: "Non authentifié." };
  if (!(await hasDashboardPermission(session.user, STAFF_PERMISSIONS.CASH_REGISTER))) {
    return { error: "Accès non autorisé." };
  }
  return { session };
}

const DEPOSIT_INCLUDE = {
  declaredBy: { select: { id: true, fullName: true } },
  confirmedBy: { select: { id: true, fullName: true } },
  movements: { select: { id: true, pieceNumber: true, amount: true, label: true, occurredAt: true } },
};

function serializeBankDeposit(deposit) {
  return {
    id: deposit.id,
    amount: Number(deposit.amount),
    declaredAmount: Number(deposit.declaredAmount),
    variance: Number(deposit.variance),
    reference: deposit.reference,
    status: deposit.status,
    note: deposit.note,
    declaredAt: deposit.declaredAt,
    declaredBy: deposit.declaredBy ? { id: deposit.declaredBy.id, fullName: deposit.declaredBy.fullName } : null,
    confirmedAt: deposit.confirmedAt,
    confirmedBy: deposit.confirmedBy ? { id: deposit.confirmedBy.id, fullName: deposit.confirmedBy.fullName } : null,
    movements: (deposit.movements ?? []).map((m) => ({
      id: m.id,
      pieceNumber: m.pieceNumber,
      amount: Number(m.amount),
      label: m.label,
      occurredAt: m.occurredAt,
    })),
  };
}

/**
 * Bundles one or more till withdrawals into a bank deposit declaration.
 *
 * `amount` is deliberately never accepted as input — it is the sum of the
 * linked withdrawals, computed here. Accepting a typed amount would let
 * "what left the till" and "what the receipt says" be made to agree just by
 * typing a bigger number, which defeats the entire point of this model.
 * `declaredAmount` is the one figure a human types in, straight off the
 * deposit slip — any gap against the computed `amount` becomes `variance`,
 * the same expected-vs-counted shape CashSession already uses.
 */
export async function declareBankDeposit({ movementIds, reference, declaredAmount, note = null }) {
  const guard = await requireBankDepositAccess();
  if (guard.error) return { success: false, message: guard.error };

  const ids = Array.isArray(movementIds) ? [...new Set(movementIds.filter(Boolean))] : [];
  if (ids.length === 0) {
    return { success: false, message: "Sélectionnez au moins un retrait à déposer." };
  }

  const trimmedReference = typeof reference === "string" ? reference.trim() : "";
  if (!trimmedReference) {
    return { success: false, message: "Indiquez la référence de l'opération bancaire (ticket de dépôt ou relevé)." };
  }

  const declared = Number(declaredAmount);
  if (!Number.isFinite(declared) || declared < 0) {
    return { success: false, message: "Le montant déposé doit être un nombre positif ou nul." };
  }

  const trimmedNote = typeof note === "string" ? note.trim() : "";

  let outcome;
  try {
    outcome = await prisma.$transaction(async (tx) => {
      const movements = await tx.cashMovement.findMany({ where: { id: { in: ids } } });

      if (movements.length !== ids.length) {
        return { error: "Un des mouvements sélectionnés est introuvable." };
      }
      if (movements.some((m) => m.type !== "WITHDRAWAL")) {
        return { error: "Seuls des retraits (sorties vers la banque) peuvent être regroupés dans un dépôt." };
      }
      if (movements.some((m) => m.bankDepositId)) {
        return { error: "Un des mouvements sélectionnés fait déjà partie d'un dépôt." };
      }

      const amount = roundMoney(movements.reduce((sum, m) => sum + Number(m.amount), 0));
      const variance = roundMoney(declared - amount);

      const deposit = await tx.bankDeposit.create({
        data: {
          amount,
          declaredAmount: roundMoney(declared),
          variance,
          reference: trimmedReference,
          declaredById: guard.session.user.id,
          note: trimmedNote || null,
        },
      });

      await tx.cashMovement.updateMany({
        where: { id: { in: ids } },
        data: { bankDepositId: deposit.id },
      });

      return { deposit };
    });
  } catch (error) {
    if (error?.code === "P2002") {
      return { success: false, message: "Cette référence bancaire est déjà utilisée par un autre dépôt." };
    }
    throw error;
  }

  if (outcome.error) return { success: false, message: outcome.error };

  const full = await prisma.bankDeposit.findUnique({ where: { id: outcome.deposit.id }, include: DEPOSIT_INCLUDE });
  revalidateCaisseRoutes();
  return { success: true, data: serializeBankDeposit(full) };
}

/**
 * Marks a declared deposit as verified against the actual bank statement —
 * the only thing that turns "a staff member says this reached the bank"
 * into something closer to proof.
 *
 * Deliberately does not require the confirming user to differ from
 * declaredById: a single-person shop must still be able to confirm its own
 * deposits. confirmedById is still recorded, so a maker/checker split can be
 * enforced later (or simply audited) without a schema change.
 */
export async function confirmBankDeposit(depositId) {
  const guard = await requireBankDepositAccess();
  if (guard.error) return { success: false, message: guard.error };

  const claim = await prisma.bankDeposit.updateMany({
    where: { id: depositId, status: "DECLARED" },
    data: { status: "CONFIRMED", confirmedAt: new Date(), confirmedById: guard.session.user.id },
  });
  if (claim.count === 0) {
    return { success: false, message: "Dépôt introuvable ou déjà confirmé." };
  }

  const updated = await prisma.bankDeposit.findUnique({ where: { id: depositId }, include: DEPOSIT_INCLUDE });
  revalidateCaisseRoutes();
  return { success: true, data: serializeBankDeposit(updated) };
}

/** Deposit history, most recent first. */
export async function listBankDeposits({ page = 1, pageSize = 20 } = {}) {
  const guard = await requireBankDepositAccess();
  if (guard.error) return { success: false, message: guard.error, data: [], totalCount: 0, page, pageSize };

  const [totalCount, deposits] = await Promise.all([
    prisma.bankDeposit.count(),
    prisma.bankDeposit.findMany({
      orderBy: { declaredAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: DEPOSIT_INCLUDE,
    }),
  ]);

  return { success: true, data: deposits.map(serializeBankDeposit), totalCount, page, pageSize };
}

/**
 * Withdrawals waiting to pick a deposit, so the deposit screen can offer
 * them for bundling instead of staff hunting through the whole cash book.
 */
export async function listUndepositedWithdrawals() {
  const guard = await requireBankDepositAccess();
  if (guard.error) return { success: false, message: guard.error, data: [] };

  const movements = await prisma.cashMovement.findMany({
    where: { type: "WITHDRAWAL", bankDepositId: null },
    orderBy: { occurredAt: "asc" },
    select: { id: true, pieceNumber: true, amount: true, label: true, occurredAt: true },
  });

  return {
    success: true,
    data: movements.map((m) => ({
      id: m.id,
      pieceNumber: m.pieceNumber,
      amount: Number(m.amount),
      label: m.label,
      occurredAt: m.occurredAt,
    })),
  };
}

/**
 * "Espèces en transit": cash that has left a till drawer but is not yet
 * verifiably at the bank — this is the one number that answers "did the
 * money actually go to the bank, or somewhere else". It is the sum of:
 *   - withdrawals never even bundled into a deposit declaration, and
 *   - deposits that were declared but never confirmed against a statement.
 * It should read zero on a healthy books; anything else is cash whose
 * whereabouts nothing in the system has verified yet.
 */
export async function getCashInTransit() {
  const guard = await requireBankDepositAccess();
  if (guard.error) return { success: false, message: guard.error, data: null };

  const [undeposited, unconfirmed] = await Promise.all([
    prisma.cashMovement.aggregate({
      where: { type: "WITHDRAWAL", bankDepositId: null },
      _sum: { amount: true },
    }),
    prisma.bankDeposit.aggregate({
      where: { status: "DECLARED" },
      _sum: { declaredAmount: true },
    }),
  ]);

  const undepositedAmount = Number(undeposited._sum.amount ?? 0);
  const unconfirmedAmount = Number(unconfirmed._sum.declaredAmount ?? 0);

  return {
    success: true,
    data: {
      undepositedAmount,
      unconfirmedAmount,
      total: roundMoney(undepositedAmount + unconfirmedAmount),
    },
  };
}
