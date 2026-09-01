import { describe, expect, it, test, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildDayReport } from "@/lib/cash-book/build-day-report";

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
          if (where.payment?.invoice === null && t.payment?.invoice != null) return false;
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

  // A sale already carrying a legal Invoice is tracked through that
  // Invoice's own record and the Opérations page — deliberately excluded
  // from the drawer's own expected balance so the same money is never
  // represented twice. byMethod (the revenue breakdown above) still counts
  // it; only the cash-reconciliation figure does not.
  it("a CASH sale that already has an invoice contributes to byMethod but not to expectedCash", async () => {
    const client = clientMock({
      session: OPEN_SESSION,
      transactions: [
        { amount: 200, method: "CASH", transactionType: "FINAL_PAYMENT", payment: { invoice: { vatRate: 21 }, order: { id: "o1" } } },
      ],
    });
    const report = await buildDayReport(client, "sess_1");
    expect(report.byMethod).toEqual({ CASH: 200 });
    // 100 (opening) + 0 (the only CASH sale is invoiced, excluded) = 100.
    expect(report.expectedCash).toBe(100);
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

describe("day-report wiring", () => {
  const actions = source("actions/dashboard/cash-book.js");
  const reportClient = source("components/dashboard/boutique/DayReportClient.jsx");
  const bookClient = source("components/dashboard/boutique/CashBookClient.jsx");

  test("getDayReport is guarded by the same permission as the till itself", () => {
    const start = actions.indexOf("export async function getDayReport");
    expect(start).toBeGreaterThan(-1);
    expect(actions.slice(start, start + 300)).toContain("requireCashBookAccess()");
  });

  // A closed CashSession is already immutable elsewhere in this codebase
  // (closeCashSession only ever acts on closedAt: null, nothing reopens
  // one) — the Z label is only honest if the screen keys off that same
  // field instead of inventing its own "finalized" flag.
  test("the Z/X label is driven by isFinal, which the builder derives from session.closedAt", () => {
    expect(reportClient).toContain("isFinal ? \"Z\" : \"X\"");
  });

  test("the cash-book page links to the report, keyed off the same closedAt", () => {
    expect(bookClient).toContain("/rapport`");
    expect(bookClient).toContain('Rapport {session.closedAt ? "Z" : "X"}');
  });
});
