import { roundMoney } from "@/lib/tax-policy";

/**
 * Pure till-reconciliation math, kept out of actions/dashboard/cash-sessions.js
 * ("use server" — every export there is a public endpoint) so it can be
 * unit-tested directly instead of through a mocked Prisma client.
 *
 * expected = opening float
 *          + CASH sales
 *          - CASH refunds
 *          + non-sale cash put in   (CashMovement CASH_IN)
 *          - non-sale cash taken out (CashMovement EXPENSE / WITHDRAWAL)
 *
 * The last two terms are what makes the figure trustworthy. Without them,
 * paying a supplier out of the drawer — an entirely routine act, and half
 * the lines of any real cash book — showed up as a closing shortfall that no
 * amount of recounting could explain, because the money really was gone and
 * the till had no way to say so.
 *
 * variance = what was actually counted minus that expectation. Negative is a
 * shortfall, positive an overage.
 */
export function computeCashVariance({
  openingFloat,
  cashIn,
  cashOut,
  counted,
  // Default 0 so the sales-only callers that predate drawer movements keep
  // computing exactly what they did before.
  movementsIn = 0,
  movementsOut = 0,
}) {
  const expectedCash = round2(
    Number(openingFloat) + Number(cashIn) - Number(cashOut) + Number(movementsIn) - Number(movementsOut)
  );
  const countedCash = round2(Number(counted));
  const variance = round2(countedCash - expectedCash);
  return { expectedCash, countedCash, variance };
}

/**
 * Splits drawer movements into the two directional totals computeCashVariance
 * expects. Amounts are stored unsigned (see model CashMovement) — `type` is
 * the only thing carrying direction, so summing them blind would add an
 * expense to the till instead of subtracting it.
 */
export function sumCashMovements(movements = []) {
  let movementsIn = 0;
  let movementsOut = 0;
  for (const movement of movements) {
    const amount = Math.abs(Number(movement.amount));
    if (movement.type === "CASH_IN") movementsIn += amount;
    else movementsOut += amount;
  }
  return { movementsIn: round2(movementsIn), movementsOut: round2(movementsOut) };
}

function round2(n) {
  return roundMoney(n);
}
