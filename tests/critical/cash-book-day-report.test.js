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
  // invoice yet — instead of a blank "rate unknown" bucket (HT/TVA stuck at
  // 0 while TTC was populated, which read as broken data), the same policy
  // an invoice would apply is used to estimate the rate, exactly like the
  // Livre de recettes already does for its own not-yet-invoiced rows.
  it("a transaction with no invoice yet is estimated at the standard Belgian rate, not left as a blank bucket", async () => {
    const client = clientMock({
      session: OPEN_SESSION,
      transactions: [
        { amount: 121, method: "ONLINE", transactionType: "DEPOSIT", payment: { invoice: null, order: { id: "o1" } } },
      ],
    });
    const report = await buildDayReport(client, "sess_1");
    expect(report.byVatRate).toEqual([{ rate: 21, netAmount: 100, vatAmount: 21, grossAmount: 121 }]);
  });

  it("an estimated-rate sale and an already-invoiced sale at the same rate merge into one row", async () => {
    const client = clientMock({
      session: OPEN_SESSION,
      transactions: [
        { amount: 121, method: "CASH", transactionType: "FINAL_PAYMENT", payment: { invoice: { vatRate: 21 }, order: { id: "o1" } } },
        { amount: 121, method: "CASH", transactionType: "FINAL_PAYMENT", payment: { invoice: null, order: { id: "o2" } } },
      ],
    });
    const report = await buildDayReport(client, "sess_1");
    expect(report.byVatRate).toEqual([{ rate: 21, netAmount: 200, vatAmount: 42, grossAmount: 242 }]);
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

  // The Livre de caisse's report is about this drawer specifically — a
  // CARD/ONLINE sale never touched it, so it must never leak in here (that
  // fuller, all-methods picture is the Livre de recettes' own report).
  it("only ever queries CASH transactions", async () => {
    const client = rangeClientMock({ sessions: [] });
    await buildRangeReport(client, RANGE);
    expect(client.transaction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ method: "CASH" }) })
    );
  });

  it("sums cash sales into totalSales and byCategory, net of refunds", async () => {
    const client = rangeClientMock({
      sessions: [],
      transactions: [
        { amount: 50, method: "CASH", transactionType: "FINAL_PAYMENT", payment: { order: { id: "o1" } } },
        { amount: 10, method: "CASH", transactionType: "REFUND", payment: { order: { id: "o1" } } },
      ],
    });
    const report = await buildRangeReport(client, RANGE);
    expect(report.totalSales).toBe(40);
    expect(report.byCategory).toEqual({ Produits: 40 });
  });

  // 14 Sep 2026: report enrichment — byCategoryCounts is a NEW, separate
  // field alongside byCategory rather than a reshape of it, so every existing
  // byCategory consumer (CaisseClient.jsx, CashBookDocument.jsx,
  // cash-book-excel.js, this file's own earlier assertions) keeps working
  // unchanged.
  it("byCategoryCounts counts transactions per category (a refund still counts as one transaction)", async () => {
    const client = rangeClientMock({
      sessions: [],
      transactions: [
        { amount: 50, method: "CASH", transactionType: "FINAL_PAYMENT", payment: { order: { id: "o1" } } },
        { amount: 30, method: "CASH", transactionType: "FINAL_PAYMENT", payment: { order: { id: "o2" } } },
        { amount: 10, method: "CASH", transactionType: "REFUND", payment: { order: { id: "o1" } } },
        { amount: 10, method: "CASH", transactionType: "FINAL_PAYMENT", payment: { appointment: { id: "a1" } } },
      ],
    });
    const report = await buildRangeReport(client, RANGE);
    expect(report.byCategoryCounts).toEqual({ Produits: 3, "Rendez-vous": 1 });
  });

  it("byVatRate carries a transaction count alongside its amounts", async () => {
    const client = rangeClientMock({
      sessions: [],
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
    const report = await buildRangeReport(client, RANGE);
    expect(report.byVatRate).toEqual([{ rate: 21, netAmount: 200, vatAmount: 42, grossAmount: 242, count: 2 }]);
  });

  // previousPeriod is a pure function of the requested window (see
  // previousPeriodWindow in build-day-report.js) — a same-length range
  // immediately preceding it, for the report's "vs. période précédente"
  // comparison.
  it("previousPeriod is a same-length window immediately before the requested range", async () => {
    const client = rangeClientMock({ sessions: [] });
    const report = await buildRangeReport(client, RANGE);
    const previousTo = new Date(report.previousPeriod.to).getTime();
    const previousFrom = new Date(report.previousPeriod.from).getTime();
    expect(previousTo).toBe(RANGE.fromDate.getTime() - 1);
    expect(previousTo - previousFrom).toBe(RANGE.toDate.getTime() - RANGE.fromDate.getTime());
    expect(report.previousPeriod).toEqual(
      expect.objectContaining({
        entrees: expect.any(Number),
        sorties: expect.any(Number),
        finalBalance: expect.any(Number),
        totalSales: expect.any(Number),
      })
    );
  });
});

describe("day-report wiring", () => {
  const actions = source("actions/dashboard/cash-book.js");
  const client = source("components/dashboard/boutique/caisse/CaisseClient.jsx");

  test("getCashReport is guarded by the same permission as the till itself", () => {
    const start = actions.indexOf("export async function getCashReport");
    expect(start).toBeGreaterThan(-1);
    expect(actions.slice(start, start + 300)).toContain("requireCashBookAccess()");
  });

  // 11 Sep 2026 redesign: no more "X"/"Z" jargon in the UI. Reversed further
  // 14 Sep 2026 (client's explicit ask): the Définitif/Provisoire pill itself
  // is gone too — isFinal is still computed (buildRangeReport, tested above)
  // but no longer surfaced as a screen label.
  test("the report no longer shows a Définitif/Provisoire pill", () => {
    expect(client).not.toContain('"Définitif"');
    expect(client).not.toContain('"Provisoire"');
    expect(client).not.toMatch(/isFinal \? "Z" : "X"/);
  });

  // 11 Sep 2026: split out to its own /rapport route because the combined
  // page had grown too long. Reversed 14 Sep 2026 (client's explicit ask):
  // back inline on the journal page — nothing to click through to see it —
  // and restricted to CASH so the report matches what "livre de caisse"
  // actually means instead of reporting every payment method.
  test("the report is fetched and rendered on the same page as the journal, not a separate route", () => {
    const page = source("app/dashboard/boutique/caisse/page.jsx");
    expect(page).toContain("getCashReport(filterInput)");
    expect(page).toContain("<CaisseClient");
    expect(client).toContain("report.byCategory");
    expect(client).toContain("report.byVatRate");
  });

  // 14 Sep 2026: the old "Imprimer" button was a plain window.print() of the
  // dashboard screen (CaissePrintHeader + a CSS @page rule) — no real
  // pagination, no letterhead worth the name. Replaced with the same
  // generated-PDF pattern the Livre de recettes already uses, plus Excel/CSV
  // exports the caisse never had before.
  const exportRoute = source("app/api/caisse/export/route.js");
  const pdfRoute = source("app/api/caisse/pdf/route.js");

  test("the Excel route re-runs the guarded actions and streams an attachment", () => {
    expect(exportRoute).toContain("getCashBookLedger(");
    expect(exportRoute).toContain("getCashReport(");
    expect(exportRoute).toContain("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(exportRoute).toContain('"Content-Disposition": `attachment;');
    expect(exportRoute).toContain('"Cache-Control": "private, no-store"');
  });

  test("the PDF route re-runs the guarded ledger action, runs on Node, and streams inline", () => {
    expect(pdfRoute).toContain('export const runtime = "nodejs"');
    expect(pdfRoute).toContain("getCashBookLedger(");
    expect(pdfRoute).toContain("renderCashBookPdf(");
    expect(pdfRoute).toContain("application/pdf");
    expect(pdfRoute).toContain('"Content-Disposition": `inline;');
    expect(pdfRoute).toContain('"Cache-Control": "private, no-store"');
  });

  // 14 Sep 2026 (client's explicit ask): printing this book went back to
  // being the journal only — days and their values — after the Rapport
  // section (category/VAT breakdown, comparison, session detail) had crept
  // into the PDF too. The Rapport stays a screen-only view; the Excel/CSV
  // exports still carry it (only "print" was called out).
  test("the PDF route no longer fetches or prints the Rapport", () => {
    expect(pdfRoute).not.toContain("getCashReport(");
    const document = source("lib/pdf/CashBookDocument.jsx");
    expect(document).not.toContain("ReportSection");
    expect(document).not.toContain("SessionsTable");
  });

  test("the client offers a CSV download, the filtered Excel link, and no more window.print()", () => {
    expect(client).toContain("text/csv;charset=utf-8");
    expect(client).toContain("function downloadCaisseCsv(");
    expect(client).toContain("/api/caisse/export?");
    expect(client).not.toContain("window.print()");
  });

  test("the client's print button opens the filtered PDF route in a new tab", () => {
    expect(client).toContain("/api/caisse/pdf?");
    expect(client).toContain('target="_blank"');
  });

  // 14 Sep 2026: report enrichment — a "vs. période précédente" comparison,
  // per-category/per-rate transaction counts, and a per-session breakdown
  // (open/close, counted vs. expected, écart) that build-day-report.js
  // already computed but nothing used to render.
  test("the client renders a previous-period comparison, transaction counts, and a session-by-session breakdown", () => {
    expect(client).toContain("report.previousPeriod");
    expect(client).toContain("DeltaBadge");
    expect(client).toContain("byCategoryCounts");
    expect(client).toContain("Sessions de caisse");
  });
});
