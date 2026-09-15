import { describe, expect, it, test, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildDayReport, buildRangeReport } from "@/lib/cash-book/build-day-report";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8").replace(/\r\n/g, "\n");

// buildDayReport delegates its own cash-reconciliation figures to
// computeSessionCashTotals (see lib/cash-book/session-totals.js), which
// aggregates rather than lists — so this mock's `aggregate` re-derives the
// same sum computeSessionCashTotals' real query would, from the same
// `transactions` fixture the byMethod/byCategory tests already use, instead
// of maintaining a second, separately-shaped fixture just for this path.
function clientMock({ session, transactions = [], movements = [] }) {
  return {
    cashSession: { findUnique: vi.fn().mockResolvedValue(session) },
    transaction: {
      findMany: vi.fn().mockResolvedValue(transactions),
      aggregate: vi.fn(({ where }) => {
        const matches = transactions.filter((t) => {
          if (where.method && t.method !== where.method) return false;
          if (typeof where.transactionType === "string" && t.transactionType !== where.transactionType) return false;
          if (where.transactionType?.not && t.transactionType === where.transactionType.not) return false;
          return true;
        });
        const sum = matches.reduce((acc, t) => acc + Number(t.amount), 0);
        return Promise.resolve({ _sum: { amount: matches.length ? sum : null } });
      }),
    },
    cashMovement: { findMany: vi.fn().mockResolvedValue(movements) },
  };
}

const OPEN_SESSION = {
  id: "sess_1",
  openedAt: new Date("2026-08-01T08:00:00Z"),
  closedAt: null,
  openingFloat: 100,
  countedCash: null,
  variance: null,
};

const CLOSED_SESSION = { ...OPEN_SESSION, closedAt: new Date("2026-08-01T19:00:00Z"), countedCash: 300, variance: 0 };

describe("buildDayReport", () => {
  it("returns null for a session that does not exist", async () => {
    const client = clientMock({ session: null });
    expect(await buildDayReport(client, "missing")).toBeNull();
  });

  it("is an X (not final) while the session is open, a Z (final) once closed", async () => {
    const open = await buildDayReport(clientMock({ session: OPEN_SESSION }), "sess_1");
    const closed = await buildDayReport(clientMock({ session: CLOSED_SESSION }), "sess_1");
    expect(open.isFinal).toBe(false);
    expect(closed.isFinal).toBe(true);
  });

  it("breaks sales down by payment method, net of refunds on the same method", async () => {
    const client = clientMock({
      session: OPEN_SESSION,
      transactions: [
        { amount: 100, method: "CASH", transactionType: "FINAL_PAYMENT", payment: { order: { id: "o1" } } },
        { amount: 200, method: "CARD", transactionType: "FINAL_PAYMENT", payment: { order: { id: "o2" } } },
        { amount: 30, method: "CASH", transactionType: "REFUND", payment: { order: { id: "o1" } } },
      ],
    });
    const report = await buildDayReport(client, "sess_1");
    expect(report.byMethod).toEqual({ CASH: 70, CARD: 200 });
  });

  it("categorizes each sale by its payment source, splitting atelier from événement by Activity.type", async () => {
    const client = clientMock({
      session: OPEN_SESSION,
      transactions: [
        { amount: 10, method: "CASH", transactionType: "FINAL_PAYMENT", payment: { order: { id: "o1" } } },
        { amount: 10, method: "CASH", transactionType: "FINAL_PAYMENT", payment: { appointment: { id: "a1" } } },
        { amount: 10, method: "CASH", transactionType: "FINAL_PAYMENT", payment: { formationReservation: { id: "f1" } } },
        {
          amount: 10,
          method: "CASH",
          transactionType: "FINAL_PAYMENT",
          payment: { workshopReservation: { session: { workshop: { type: "WORKSHOP" } } } },
        },
        {
          amount: 10,
          method: "CASH",
          transactionType: "FINAL_PAYMENT",
          payment: { workshopReservation: { session: { workshop: { type: "EVENT" } } } },
        },
      ],
    });
    const report = await buildDayReport(client, "sess_1");
    expect(report.byCategory).toEqual({
      Produits: 10,
      "Rendez-vous": 10,
      Formations: 10,
      Ateliers: 10,
      Événements: 10,
    });
  });

  it("backs VAT out of each transaction's own amount at its invoice's rate, grouped by rate", async () => {
    const client = clientMock({
      session: OPEN_SESSION,
      transactions: [
        {
          amount: 121,
          method: "CASH",
          transactionType: "FINAL_PAYMENT",
          payment: { invoice: { vatRate: 21 }, order: { id: "o1" } },
        },
        {
          amount: 121,
          method: "CASH",
          transactionType: "FINAL_PAYMENT",
          payment: { invoice: { vatRate: 21 }, order: { id: "o2" } },
        },
      ],
    });
    const report = await buildDayReport(client, "sess_1");
    expect(report.byVatRate).toEqual([{ rate: 21, netAmount: 200, vatAmount: 42, grossAmount: 242 }]);
  });

  // An online deposit collected before the final invoice is issued has no
  // invoice yet — it must land in its own bucket instead of silently
  // vanishing from the VAT report or crashing on a null vatRate.
  it("a transaction with no invoice yet falls into an 'unknown rate' bucket instead of being dropped", async () => {
    const client = clientMock({
      session: OPEN_SESSION,
      transactions: [
        { amount: 50, method: "ONLINE", transactionType: "DEPOSIT", payment: { invoice: null, order: { id: "o1" } } },
      ],
    });
    const report = await buildDayReport(client, "sess_1");
    expect(report.byVatRate).toEqual([{ rate: null, netAmount: 0, vatAmount: 0, grossAmount: 50 }]);
  });

  it("a refund reduces its VAT bucket instead of adding to it", async () => {
    const client = clientMock({
      session: OPEN_SESSION,
      transactions: [
        {
          amount: 121,
          method: "CASH",
          transactionType: "REFUND",
          payment: { invoice: { vatRate: 21 }, order: { id: "o1" } },
        },
      ],
    });
    const report = await buildDayReport(client, "sess_1");
    expect(report.byVatRate).toEqual([{ rate: 21, netAmount: -100, vatAmount: -21, grossAmount: -121 }]);
  });

  it("expectedCash matches computeCashVariance's own arithmetic for the CASH method alone", async () => {
    const client = clientMock({
      session: OPEN_SESSION,
      transactions: [
        { amount: 200, method: "CASH", transactionType: "FINAL_PAYMENT", payment: { order: { id: "o1" } } },
        { amount: 500, method: "CARD", transactionType: "FINAL_PAYMENT", payment: { order: { id: "o2" } } },
      ],
      movements: [{ type: "EXPENSE", amount: 30 }],
    });
    const report = await buildDayReport(client, "sess_1");
    // 100 (opening) + 200 (cash sales) - 30 (expense) = 270 — CARD plays no part.
    expect(report.expectedCash).toBe(270);
  });

  // An invoice is a separate legal record of the sale (see the Opérations
  // page), but the cash it was paid in is still physically in the drawer —
  // it counts toward both the revenue breakdown and the cash-reconciliation
  // figure the same as any other CASH sale.
  it("a CASH sale that already has an invoice contributes to byMethod and to expectedCash alike", async () => {
    const client = clientMock({
      session: OPEN_SESSION,
      transactions: [
        { amount: 200, method: "CASH", transactionType: "FINAL_PAYMENT", payment: { invoice: { vatRate: 21 }, order: { id: "o1" } } },
      ],
    });
    const report = await buildDayReport(client, "sess_1");
    expect(report.byMethod).toEqual({ CASH: 200 });
    // 100 (opening) + 200 (the invoiced CASH sale, included) = 300.
    expect(report.expectedCash).toBe(300);
  });

  it("only reads transactions within the session's own open-to-close window", async () => {
    const client = clientMock({ session: CLOSED_SESSION });
    await buildDayReport(client, "sess_1");
    expect(client.transaction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          paidAt: { gte: CLOSED_SESSION.openedAt, lte: CLOSED_SESSION.closedAt },
        }),
      })
    );
  });
});

/**
 * Same aggregate-faking approach as clientMock above, but for the
 * range-based report: cashSession.findMany replaces findUnique, and
 * transactions are shared across however many sessions are in range —
 * computeSessionCashTotals is called once per session, so cashIn/cashOut
 * aggregates are filtered by cashSessionId too.
 */
function rangeClientMock({ sessions, transactions = [], movements = [] }) {
  return {
    cashSession: { findMany: vi.fn().mockResolvedValue(sessions) },
    transaction: {
      findMany: vi.fn().mockResolvedValue(transactions),
      aggregate: vi.fn(({ where }) => {
        const matches = transactions.filter((t) => {
          if (where.cashSessionId && t.cashSessionId !== where.cashSessionId) return false;
          if (where.method && t.method !== where.method) return false;
          if (typeof where.transactionType === "string" && t.transactionType !== where.transactionType) return false;
          if (where.transactionType?.not && t.transactionType === where.transactionType.not) return false;
          return true;
        });
        const sum = matches.reduce((acc, t) => acc + Number(t.amount), 0);
        return Promise.resolve({ _sum: { amount: matches.length ? sum : null } });
      }),
    },
    cashMovement: {
      findMany: vi.fn(({ where }) => Promise.resolve(movements.filter((m) => m.cashSessionId === where.cashSessionId))),
    },
  };
}

describe("buildRangeReport", () => {
  const RANGE = { fromDate: new Date("2026-08-01T00:00:00"), toDate: new Date("2026-08-01T23:59:59.999") };

  it("a range with no sessions is not final — nothing to finalize", async () => {
    const report = await buildRangeReport(rangeClientMock({ sessions: [] }), RANGE);
    expect(report.isFinal).toBe(false);
    expect(report.expectedCash).toBeNull();
  });

  it("is final once every session in range is closed", async () => {
    const client = rangeClientMock({
      sessions: [{ id: "s1", openingFloat: 100, closedAt: new Date("2026-08-01T19:00:00Z"), countedCash: 100, variance: 0, isAutoOpened: false, isAutoClosed: true }],
    });
    const report = await buildRangeReport(client, RANGE);
    expect(report.isFinal).toBe(true);
  });

  it("stays provisional while any session in range is still open", async () => {
    const client = rangeClientMock({
      sessions: [
        { id: "s1", openingFloat: 100, closedAt: new Date("2026-08-01T12:00:00Z"), countedCash: 150, variance: 0, isAutoOpened: false, isAutoClosed: false },
        { id: "s2", openingFloat: 150, closedAt: null, countedCash: null, variance: null, isAutoOpened: true, isAutoClosed: false },
      ],
    });
    const report = await buildRangeReport(client, RANGE);
    expect(report.isFinal).toBe(false);
  });

  // Period totals (apports/sorties) sum across every session, but
  // expectedCash is the LAST session's own figure, not a sum — see the
  // module doc comment on double-counting.
  it("sums cash movements across every session in range, but expectedCash is only the most recent session's", async () => {
    const client = rangeClientMock({
      sessions: [
        { id: "s1", openingFloat: 100, closedAt: new Date("2026-08-01T12:00:00Z"), countedCash: 100, variance: 0, isAutoOpened: false, isAutoClosed: false },
        { id: "s2", openingFloat: 100, closedAt: null, countedCash: null, variance: null, isAutoOpened: true, isAutoClosed: false },
      ],
      movements: [
        { cashSessionId: "s1", type: "CASH_IN", amount: 20 },
        { cashSessionId: "s2", type: "EXPENSE", amount: 15 },
      ],
    });
    const report = await buildRangeReport(client, RANGE);
    expect(report.cashMovements).toEqual({ in: 20, out: 15 });
    // Second session: 100 (opening) - 15 (expense) = 85, independent of s1.
    expect(report.expectedCash).toBe(85);
  });
});

describe("day-report wiring", () => {
  const actions = source("actions/dashboard/cash-book.js");
  const client = source("components/dashboard/boutique/caisse/CaisseRapportClient.jsx");

  test("getCashReport is guarded by the same permission as the till itself", () => {
    const start = actions.indexOf("export async function getCashReport");
    expect(start).toBeGreaterThan(-1);
    expect(actions.slice(start, start + 300)).toContain("requireCashBookAccess()");
  });

  // 11 Sep 2026 redesign: no more "X"/"Z" jargon in the UI (client's
  // explicit ask), labeled by isFinal alone. Revised 11 Sep 2026 (same day):
  // the report moved to its own /rapport route (CaisseRapportClient) because
  // the combined journal+report page had grown too long — CaisseClient.jsx
  // now only links to it.
  test("the report is labeled Définitif/Provisoire, driven by isFinal, not X/Z jargon", () => {
    expect(client).toContain('report.isFinal');
    expect(client).toContain('"Définitif"');
    expect(client).toContain('"Provisoire"');
    expect(client).not.toMatch(/isFinal \? "Z" : "X"/);
  });

  test("the report lives on its own route, linked from the journal page rather than inlined", () => {
    const page = source("app/dashboard/boutique/caisse/rapport/page.jsx");
    expect(page).toContain("getCashReport(filterInput)");
    const journalClient = source("components/dashboard/boutique/caisse/CaisseClient.jsx");
    expect(journalClient).toContain("/dashboard/boutique/caisse/rapport");
  });

  // Superseded by the "lives on its own route" test above (11 Sep 2026, same
  // day as the redesign it originally pinned) — the report was moved out of
  // CaisseClient.jsx into its own page once the combined page grew too long.
  test("the report page is reachable and guarded the same way the journal page is", () => {
    const page = source("app/dashboard/boutique/caisse/rapport/page.jsx");
    expect(page).toContain("requireDashboardPermission(STAFF_PERMISSIONS.CASH_REGISTER)");
  });
});
