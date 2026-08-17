/**
 * Pure till-reconciliation math, kept out of actions/dashboard/cash-sessions.js
 * ("use server" — every export there is a public endpoint) so it can be
 * unit-tested directly instead of through a mocked Prisma client.
 *
 * expected = opening float + CASH sales - CASH refunds recorded against the
 * session; variance = what was actually counted minus that expectation.
 */
export function computeCashVariance({ openingFloat, cashIn, cashOut, counted }) {
  const expectedCash = round2(Number(openingFloat) + Number(cashIn) - Number(cashOut));
  const countedCash = round2(Number(counted));
  const variance = round2(countedCash - expectedCash);
  return { expectedCash, countedCash, variance };
}

function round2(n) {
  return Math.round(n * 100) / 100;
}
