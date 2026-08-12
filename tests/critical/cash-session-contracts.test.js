import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { computeCashVariance } from "../../lib/cash-sessions.js";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8");

// No shift/session concept existed before this — every CASH sale was
// tracked individually (Transaction.cashReceived/changeGiven) but nothing
// gave a running expected total or a counted-vs-expected reconciliation, so
// a till shortfall was only findable by recounting every sale one by one.
describe("cash-session variance math", () => {
  test("matches exactly when the counted amount equals opening float + cash sales", () => {
    const result = computeCashVariance({ openingFloat: 100, cashIn: 245.5, cashOut: 0, counted: 345.5 });
    expect(result).toEqual({ expectedCash: 345.5, countedCash: 345.5, variance: 0 });
  });

  test("a shortfall is reported as a negative variance", () => {
    const result = computeCashVariance({ openingFloat: 100, cashIn: 200, cashOut: 0, counted: 280 });
    expect(result.expectedCash).toBe(300);
    expect(result.variance).toBe(-20);
  });

  test("an overage is reported as a positive variance", () => {
    const result = computeCashVariance({ openingFloat: 100, cashIn: 200, cashOut: 0, counted: 310 });
    expect(result.variance).toBe(10);
  });

  test("cash refunds reduce the expected total", () => {
    const result = computeCashVariance({ openingFloat: 100, cashIn: 200, cashOut: 30, counted: 270 });
    expect(result.expectedCash).toBe(270);
    expect(result.variance).toBe(0);
  });

  test("rounds to the cent, avoiding float drift", () => {
    const result = computeCashVariance({ openingFloat: 0.1, cashIn: 0.2, cashOut: 0, counted: 0.3 });
    expect(result.expectedCash).toBe(0.3);
    expect(result.variance).toBe(0);
  });
});

describe("cash-session wiring", () => {
  const actions = source("actions/dashboard/cash-sessions.js");
  const pos = source("actions/boutique/point-of-sale.js");
  const schema = source("prisma/schema.prisma");

  test("closing is an atomic claim gated on the session still being open", () => {
    expect(actions).toContain("cashSession.updateMany");
    expect(actions).toContain("where: { id: sessionId, closedAt: null }");
    expect(actions).toContain("if (claim.count === 0)");
  });

  test("opening refuses a second concurrently-open session", () => {
    expect(actions).toContain("findFirst({ where: { closedAt: null } })");
    expect(actions).toContain("Une session de caisse est déjà ouverte");
  });

  test("POS attaches CASH sales to whichever session is open, without ever blocking the sale", () => {
    expect(pos).toContain("cashSession.findFirst({ where: { closedAt: null }");
    expect(pos).toContain("cashSessionId: openCashSession?.id ?? null");
  });

  test("CashSession is modeled with the expected/counted/variance breakdown", () => {
    expect(schema).toContain("model CashSession");
    expect(schema).toContain("expectedCash Decimal?");
    expect(schema).toContain("countedCash  Decimal?");
    expect(schema).toContain("variance     Decimal?");
  });
});
