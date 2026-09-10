import { describe, expect, it, test, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildRecettesJournal } from "@/lib/livre-de-recettes/build-recettes-journal";
import {
  normalizeRecettesParams,
  MAX_JOURNAL_ROWS,
  MAX_RANGE_DAYS,
  RECETTES_METHODS,
} from "@/lib/livre-de-recettes/filters";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8").replace(/\r\n/g, "\n");

function clientMock(transactions = []) {
  return {
    transaction: {
      findMany: vi.fn(({ where }) => {
        let matched = transactions;
        if (where?.method) matched = matched.filter((t) => t.method === where.method);
        return Promise.resolve(matched);
      }),
    },
  };
}

const RANGE = normalizeRecettesParams({ from: "2026-08-01", to: "2026-08-31" });

function txn(overrides = {}) {
  return {
    id: overrides.id ?? "t1",
    amount: 100,
    method: "CASH",
    transactionType: "FINAL_PAYMENT",
    paidAt: new Date("2026-08-10T10:00:00Z"),
    pieceNumber: null,
    cashSessionId: null,
    manualReference: null,
    stripePaymentIntentId: null,
    payment: { order: { orderNumber: 42 } },
    ...overrides,
  };
}

describe("buildRecettesJournal", () => {
  it("excludes soft-deleted transactions in the query itself", async () => {
    const client = clientMock();
    await buildRecettesJournal(client, RANGE);
    expect(client.transaction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ isDeleted: false }) })
    );
  });

  it("windows the query on paidAt between the normalized range bounds", async () => {
    const client = clientMock();
    await buildRecettesJournal(client, RANGE);
    expect(client.transaction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ paidAt: { gte: RANGE.fromDate, lte: RANGE.toDate } }),
      })
    );
  });

  it("pushes a method filter to the database, and omits it entirely for ALL", async () => {
    const cashClient = clientMock();
    await buildRecettesJournal(cashClient, { ...RANGE, method: "CASH" });
    expect(cashClient.transaction.findMany.mock.calls[0][0].where.method).toBe("CASH");

    const allClient = clientMock();
    await buildRecettesJournal(allClient, { ...RANGE, method: "ALL" });
    expect(allClient.transaction.findMany.mock.calls[0][0].where).not.toHaveProperty("method");
  });

  it("nets a refund off its own method and reduces the total, keeping it as a negative line", async () => {
    const client = clientMock([
      txn({ id: "a", amount: 100, method: "CASH", transactionType: "FINAL_PAYMENT" }),
      txn({ id: "b", amount: 200, method: "CARD", transactionType: "FINAL_PAYMENT" }),
      txn({ id: "c", amount: 30, method: "CASH", transactionType: "REFUND" }),
    ]);
    const journal = await buildRecettesJournal(client, RANGE);

    const cash = journal.summary.byMethod.find((m) => m.method === "CASH");
    expect(cash).toMatchObject({ net: 70, refunded: 30 });
    expect(journal.summary.total).toBe(270);
    expect(journal.summary.grossInflow).toBe(300);
    expect(journal.summary.refundTotal).toBe(30);

    const refundRow = journal.rows.find((r) => r.id === "c");
    expect(refundRow.isRefund).toBe(true);
    expect(refundRow.signedAmount).toBe(-30);
  });

  it("includes off-till cash and flags it, so the divergence from the cash book is visible", async () => {
    const client = clientMock([
      txn({ id: "onTill", method: "CASH", cashSessionId: "sess_1", pieceNumber: "V0001" }),
      txn({ id: "offTill", method: "CASH", cashSessionId: null, pieceNumber: null }),
      txn({ id: "card", method: "CARD", cashSessionId: null }),
    ]);
    const journal = await buildRecettesJournal(client, RANGE);

    expect(journal.rows).toHaveLength(3);
    expect(journal.rows.find((r) => r.id === "offTill").offTill).toBe(true);
    expect(journal.rows.find((r) => r.id === "onTill").offTill).toBe(false);
    // A card payment is never "off-till" — that concept only applies to cash.
    expect(journal.rows.find((r) => r.id === "card").offTill).toBe(false);
  });

  it("categorizes each row by its payment source, splitting atelier from événement, with an OTHER bucket", async () => {
    const client = clientMock([
      txn({ id: "o", amount: 10, payment: { order: { orderNumber: 1 } } }),
      txn({ id: "a", amount: 10, payment: { appointment: { staffService: { service: { name: "Soin" } } } } }),
      txn({ id: "f", amount: 10, payment: { formationReservation: { session: { formation: { title: "F" } } } } }),
      txn({ id: "w", amount: 10, payment: { workshopReservation: { session: { workshop: { type: "WORKSHOP", title: "W" } } } } }),
      txn({ id: "e", amount: 10, payment: { workshopReservation: { session: { workshop: { type: "EVENT", title: "E" } } } } }),
      txn({ id: "x", amount: 10, payment: null }),
    ]);
    const journal = await buildRecettesJournal(client, RANGE);
    const byCategory = Object.fromEntries(journal.summary.byCategory.map((c) => [c.category, c.net]));
    expect(byCategory).toEqual({ ORDER: 10, APPOINTMENT: 10, FORMATION: 10, WORKSHOP: 10, EVENT: 10, OTHER: 10 });
  });

  it("applies the category filter in memory, never widening the query", async () => {
    const client = clientMock([
      txn({ id: "o", payment: { order: { orderNumber: 1 } } }),
      txn({ id: "w", payment: { workshopReservation: { session: { workshop: { type: "WORKSHOP" } } } } }),
    ]);
    const journal = await buildRecettesJournal(client, { ...RANGE, category: "ORDER" });
    expect(journal.rows.map((r) => r.id)).toEqual(["o"]);
    // The polymorphic source is unreachable from Prisma's where — the query must not try.
    const where = client.transaction.findMany.mock.calls[0][0].where;
    expect(where).not.toHaveProperty("category");
    expect(where).not.toHaveProperty("payment");
  });

  it("backs HT and VAT out of each amount at its invoice rate", async () => {
    const client = clientMock([
      txn({ id: "a", amount: 121, payment: { order: { orderNumber: 1 }, invoice: { number: "2026-000001", vatRate: 21 } } }),
    ]);
    const journal = await buildRecettesJournal(client, RANGE);
    expect(journal.rows[0]).toMatchObject({ amountTtc: 121, amountHt: 100, amountVat: 21, vatRate: 21 });
    expect(journal.summary.byVatRate).toEqual([{ rate: 21, netAmount: 100, vatAmount: 21, grossAmount: 121 }]);
  });

  it("puts a not-yet-invoiced payment in a null-rate bucket instead of dropping it", async () => {
    const client = clientMock([
      txn({ id: "a", amount: 50, method: "ONLINE", transactionType: "DEPOSIT", payment: { order: { orderNumber: 1 }, invoice: null } }),
    ]);
    const journal = await buildRecettesJournal(client, RANGE);
    expect(journal.rows[0]).toMatchObject({ amountHt: null, amountVat: null, vatRate: null });
    expect(journal.summary.byVatRate).toEqual([{ rate: null, netAmount: 0, vatAmount: 0, grossAmount: 50 }]);
  });

  it("the last row's running total equals the summary total (ALL / ALL)", async () => {
    const client = clientMock([
      txn({ id: "a", amount: 100, method: "CASH" }),
      txn({ id: "b", amount: 210, method: "CARD" }),
      txn({ id: "c", amount: 40, method: "ONLINE", transactionType: "REFUND" }),
    ]);
    const journal = await buildRecettesJournal(client, RANGE);
    expect(journal.rows.at(-1).runningTotal).toBe(journal.summary.total);
    expect(journal.summary.total).toBe(270);
  });

  it("flags truncation when the query returns more than the cap", async () => {
    const overflow = Array.from({ length: MAX_JOURNAL_ROWS + 1 }, (_, i) => txn({ id: `t${i}` }));
    const journal = await buildRecettesJournal(clientMock(overflow), RANGE);
    expect(journal.truncated).toBe(true);
    expect(journal.rows).toHaveLength(MAX_JOURNAL_ROWS);

    const exact = Array.from({ length: MAX_JOURNAL_ROWS }, (_, i) => txn({ id: `t${i}` }));
    const full = await buildRecettesJournal(clientMock(exact), RANGE);
    expect(full.truncated).toBe(false);
  });

  it("caps the query itself so an unbounded scan is impossible", async () => {
    const client = clientMock();
    await buildRecettesJournal(client, RANGE);
    expect(client.transaction.findMany.mock.calls[0][0].take).toBe(MAX_JOURNAL_ROWS + 1);
  });
});

describe("normalizeRecettesParams — a hand-edited query string cannot widen the journal", () => {
  test("defaults to the current calendar month", () => {
    const now = new Date();
    const { from } = normalizeRecettesParams({});
    expect(from).toBe(
      `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`
    );
  });

  test.each([
    ["not-a-date", "junk"],
    ["2026-13-01", "an impossible month"],
    ["2026-02-30", "an impossible day"],
    ["'; DROP TABLE", "an injection attempt"],
    ["", "empty"],
  ])("%s is ignored (%s)", (bad) => {
    const def = normalizeRecettesParams({});
    expect(normalizeRecettesParams({ from: bad, to: bad }).from).toBe(def.from);
  });

  test("an over-long window is clamped to the maximum span", () => {
    const { fromDate, toDate } = normalizeRecettesParams({ from: "2000-01-01", to: "2026-08-31" });
    const spanDays = (toDate.getTime() - fromDate.getTime()) / (24 * 60 * 60 * 1000);
    expect(spanDays).toBeLessThanOrEqual(MAX_RANGE_DAYS + 1);
  });

  test("an inverted range resets both ends rather than querying backwards", () => {
    const def = normalizeRecettesParams({});
    const { from, to } = normalizeRecettesParams({ from: "2026-08-31", to: "2026-08-01" });
    expect(from).toBe(def.from);
    expect(to).toBe(def.to);
  });

  test("the end of the range includes its whole day", () => {
    const { toDate } = normalizeRecettesParams({ from: "2026-08-01", to: "2026-08-15" });
    expect(toDate.getHours()).toBe(23);
    expect(toDate.getMinutes()).toBe(59);
    expect(toDate.getSeconds()).toBe(59);
  });

  test.each([...RECETTES_METHODS, "ALL"])("%s is a valid method, anything else falls back to ALL", (method) => {
    expect(normalizeRecettesParams({ method }).method).toBe(method === "ALL" ? "ALL" : method);
    expect(normalizeRecettesParams({ method: "BANK_TRANSFER" }).method).toBe("ALL");
  });
});

describe("wiring", () => {
  const action = source("actions/dashboard/get-recettes-journal.js");
  const page = source("app/dashboard/livre-de-recettes/page.jsx");
  const route = source("app/api/recettes/export/route.js");
  const client = source("components/dashboard/recettes/RecettesJournalClient.jsx");
  const filters = source("lib/livre-de-recettes/filters.js");

  test("the shared filter vocabulary stays out of the server action", () => {
    expect(filters.trimStart().startsWith('"use server"')).toBe(false);
    const exports = action.match(/^export .*/gm) ?? [];
    expect(exports.length).toBeGreaterThan(0);
    for (const line of exports) {
      expect(line, `"${line}" is not an async function export`).toMatch(/^export async function /);
    }
  });

  test("both the page and the action normalize params from the plain module", () => {
    expect(action).toContain('from "@/lib/livre-de-recettes/filters"');
    expect(action).toContain("normalizeRecettesParams(params)");
    expect(page).toContain("const params = await searchParams;");
    expect(page).toContain("getRecettesJournal(");
  });

  test("the page is gated at the reports tier and the action re-checks it", () => {
    expect(page).toContain("requireRole(DASHBOARD_PERMISSIONS.REPORTS)");
    expect(action).toContain("hasPermission(session.user.role, DASHBOARD_PERMISSIONS.REPORTS)");
  });

  test("the Excel route re-runs the guarded action and streams an attachment", () => {
    expect(route).toContain("getRecettesJournal(");
    expect(route).toContain("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(route).toContain('"Content-Disposition": `attachment;');
    expect(route).toContain('"Cache-Control": "private, no-store"');
  });

  test("the client offers both a CSV download and the filtered Excel link", () => {
    expect(client).toContain("text/csv;charset=utf-8");
    expect(client).toContain("function downloadRecettesCsv(data)");
    expect(client).toContain("/api/recettes/export?");
  });
});
