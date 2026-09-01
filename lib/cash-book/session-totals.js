import { computeCashVariance, sumCashMovements } from "@/lib/cash-sessions";

/**
 * The live cash position of one till session: what the drawer should hold
 * right now, from the four things that can move it.
 *
 * Shared deliberately by three callers that must never disagree — the close
 * reconciliation, the guard that refuses to take more cash out than the
 * drawer holds, and the X/Z day report. Computing "expected cash" in three
 * places is how a report ends up contradicting the closure it describes.
 *
 * Accepts a `client` rather than importing prisma so it can run inside the
 * caller's transaction: the withdrawal guard has to read the balance and
 * write the movement atomically, or two concurrent withdrawals each see
 * enough cash for themselves and together overdraw the till.
 */
export async function computeSessionCashTotals(client, sessionId, openingFloat) {
  // A sale whose Payment already carries a legal Invoice is tracked through
  // that Invoice's own record and the Opérations page — deliberately
  // excluded from every figure this drawer reports, so the same money is
  // never represented twice. Deliberate tradeoff, accepted by the salon:
  // cash actually in the drawer from an invoiced sale no longer contributes
  // to the till's own expected balance.
  const [cashInAgg, cashOutAgg, movements] = await Promise.all([
    client.transaction.aggregate({
      where: { cashSessionId: sessionId, method: "CASH", transactionType: { not: "REFUND" }, isDeleted: false, payment: { invoice: null } },
      _sum: { amount: true },
    }),
    client.transaction.aggregate({
      where: { cashSessionId: sessionId, method: "CASH", transactionType: "REFUND", isDeleted: false, payment: { invoice: null } },
      _sum: { amount: true },
    }),
    client.cashMovement.findMany({ where: { cashSessionId: sessionId }, select: { type: true, amount: true } }),
  ]);

  const cashIn = Number(cashInAgg._sum.amount ?? 0);
  const cashOut = Number(cashOutAgg._sum.amount ?? 0);
  const { movementsIn, movementsOut } = sumCashMovements(movements);

  // Reuses the variance helper with counted = 0 purely to get `expectedCash`
  // through the exact same arithmetic and rounding the closure will use.
  const { expectedCash } = computeCashVariance({
    openingFloat,
    cashIn,
    cashOut,
    counted: 0,
    movementsIn,
    movementsOut,
  });

  return { cashIn, cashOut, movementsIn, movementsOut, expectedCash };
}
