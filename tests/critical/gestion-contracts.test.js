import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { allocateExpenseToPeriod, parseSalonExpenseInput } from "@/lib/gestion/expenses";
import { normalizeGestionParams } from "@/lib/gestion/filters";
import { buildGestionReport } from "@/lib/gestion/build-gestion-report";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8").replace(/\r\n/g, "\n");

const d = (y, m, day) => new Date(y, m - 1, day);
const endOf = (y, m, day) => new Date(y, m - 1, day, 23, 59, 59, 999);

describe("parseSalonExpenseInput", () => {
  it("accepts a monthly rent and stores the first day of each month", () => {
    const { data, errors } = parseSalonExpenseInput({
      category: "RENT",
      label: " Loyer du salon ",
      amountTtc: "1200",
      vatRate: 0,
      isRecurring: true,
      startMonth: "2026-09",
      endMonth: "2027-08",
    });
    expect(errors).toBeUndefined();
    expect(data.label).toBe("Loyer du salon");
    expect(data.amountTtc).toBe(1200);
    expect(data.date).toEqual(d(2026, 9, 1));
    expect(data.endDate).toEqual(d(2027, 8, 1));
  });

  it("rejects bad amounts, unknown VAT rates, and an end month before the start", () => {
    const { errors } = parseSalonExpenseInput({
      category: "RENT",
      label: "Loyer",
      amountTtc: "-5",
      vatRate: 19,
      isRecurring: true,
      startMonth: "2026-09",
      endMonth: "2026-08",
    });
    expect(Object.keys(errors).sort()).toEqual(["amountTtc", "endMonth", "vatRate"]);
  });

  it("requires a date on a one-off bill and a known category", () => {
    const { errors } = parseSalonExpenseInput({ category: "CAR", label: "x", amountTtc: 10, vatRate: 21 });
    expect(errors.category).toBeDefined();
    expect(errors.date).toBeDefined();
  });
});

describe("allocateExpenseToPeriod", () => {
  const rent = { amountTtc: 1200, vatRate: 0, date: d(2026, 9, 1), isRecurring: true, endDate: null };

  it("counts a monthly charge once per whole month covered", () => {
    const result = allocateExpenseToPeriod(rent, d(2026, 9, 1), endOf(2026, 11, 30));
    expect(result.amountTtc).toBe(3600);
    expect(result.prorated).toBe(false);
    expect(result.byMonth.map((m) => m.month)).toEqual(["2026-09", "2026-10", "2026-11"]);
  });

  it("prorates by day when the period covers part of a month", () => {
    const result = allocateExpenseToPeriod(rent, d(2026, 9, 1), endOf(2026, 9, 15));
    expect(result.amountTtc).toBe(600); // 15/30 of September
    expect(result.prorated).toBe(true);
  });

  it("never counts months before the start or after the end month", () => {
    const bounded = { ...rent, endDate: d(2026, 10, 1) };
    const result = allocateExpenseToPeriod(bounded, d(2026, 8, 1), endOf(2026, 12, 31));
    expect(result.byMonth.map((m) => m.month)).toEqual(["2026-09", "2026-10"]);
    expect(result.amountTtc).toBe(2400);
  });

  it("derives the HT base from the VAT rate", () => {
    const internet = { amountTtc: 60.5, vatRate: 21, date: d(2026, 9, 1), isRecurring: true, endDate: null };
    expect(allocateExpenseToPeriod(internet, d(2026, 9, 1), endOf(2026, 9, 30)).amountHt).toBe(50);
  });

  it("counts a one-off bill only when its date is inside the period", () => {
    const bill = { amountTtc: 121, vatRate: 21, date: d(2026, 9, 20), isRecurring: false, endDate: null };
    expect(allocateExpenseToPeriod(bill, d(2026, 9, 1), endOf(2026, 9, 30)).amountHt).toBe(100);
    expect(allocateExpenseToPeriod(bill, d(2026, 10, 1), endOf(2026, 10, 31)).amountTtc).toBe(0);
  });
});

describe("buildGestionReport", () => {
  function clientMock({ transactions, orderTransactions = [], cashMovements = [], expenses = [] }) {
    return {
      user: { findMany: vi.fn(() => Promise.resolve([{ id: "u_admin", staff: null }])) },
      transaction: {
        findMany: vi.fn(({ where }) => {
          // Second call: the order-cost lookup by id.
          if (where?.id?.in) return Promise.resolve(orderTransactions.filter((t) => where.id.in.includes(t.id)));
          return Promise.resolve(transactions);
        }),
      },
      cashMovement: { findMany: vi.fn(() => Promise.resolve(cashMovements)) },
      salonExpense: { findMany: vi.fn(() => Promise.resolve(expenses)) },
    };
  }

  const orderPayment = { order: { orderNumber: 1, user: null }, invoice: { number: "F-1", vatRate: 21 } };
  const servicePayment = {
    appointment: { user: null, staffService: { service: { name: "Soin" } } },
    invoice: { number: "F-2", vatRate: 21 },
  };

  it("subtracts product cost, salon charges and till expenses from HT revenue", async () => {
    const client = clientMock({
      transactions: [
        { id: "t1", amount: 121, paidAt: d(2026, 9, 3), method: "CARD", transactionType: "FINAL_PAYMENT", payment: orderPayment },
        { id: "t2", amount: 242, paidAt: d(2026, 9, 4), method: "CASH", transactionType: "FINAL_PAYMENT", payment: servicePayment },
      ],
      orderTransactions: [
        {
          id: "t1",
          amount: 121,
          payment: {
            totalAmount: 121,
            order: {
              items: [
                { quantity: 2, variantId: "v1", variant: { costPrice: 20 } },
                { quantity: 1, variantId: null, variant: null }, // ad-hoc service line — no cost
              ],
            },
          },
        },
      ],
      cashMovements: [{ id: "m1", amount: 10, label: "Dépense: sacs", pieceNumber: "D0001", occurredAt: d(2026, 9, 5) }],
      expenses: [
        { id: "e1", category: "RENT", label: "Loyer", amountTtc: 150, vatRate: 0, date: d(2026, 9, 1), isRecurring: true, endDate: null },
      ],
    });

    const report = await buildGestionReport(client, normalizeGestionParams({ from: "2026-09-01", to: "2026-09-30" }));

    expect(report.summary.revenueHt).toBe(300); // 100 + 200
    expect(report.summary.costHt).toBe(40);
    expect(report.summary.grossMarginHt).toBe(260);
    expect(report.summary.chargesHt).toBe(150);
    expect(report.summary.cashExpenses).toBe(10);
    expect(report.summary.netProfitHt).toBe(100);
    expect(report.categories.find((c) => c.category === "ORDER").marginHt).toBe(60);
    expect(report.months).toEqual([
      expect.objectContaining({ month: "2026-09", revenueHt: 300, costHt: 40, chargesHt: 150, cashExpenses: 10, netProfitHt: 100 }),
    ]);
  });

  it("gives a refund its share of the product cost back, and prorates cost on an acompte", async () => {
    const client = clientMock({
      transactions: [
        { id: "t1", amount: 60.5, paidAt: d(2026, 9, 3), method: "CARD", transactionType: "DEPOSIT", payment: orderPayment },
        { id: "t2", amount: 60.5, paidAt: d(2026, 9, 9), method: "CARD", transactionType: "REFUND", payment: orderPayment },
      ],
      orderTransactions: ["t1", "t2"].map((id) => ({
        id,
        amount: 60.5,
        payment: { totalAmount: 121, order: { items: [{ quantity: 1, variantId: "v1", variant: { costPrice: 40 } }] } },
      })),
    });

    const report = await buildGestionReport(client, normalizeGestionParams({ from: "2026-09-01", to: "2026-09-30" }));
    expect(report.summary.revenueHt).toBe(0);
    expect(report.summary.costHt).toBe(0);
  });

  it("does not compute a net profit for a single category — charges are salon-wide", async () => {
    const client = clientMock({ transactions: [] });
    const report = await buildGestionReport(
      client,
      normalizeGestionParams({ from: "2026-09-01", to: "2026-09-30", category: "APPOINTMENT" }),
    );
    expect(report.summary.netProfitHt).toBeNull();
  });

  it("reads revenue through the salon-scoped Livre de recettes, never its own query", () => {
    const builder = source("lib/gestion/build-gestion-report.js");
    expect(builder).toContain("buildRecettesJournal(client");
    expect(builder).not.toMatch(/staffId/);
  });
});

describe("Gestion wiring", () => {
  it("is OWNER/ADMIN only, on every server action", () => {
    const actions = source("actions/dashboard/gestion.js");
    expect(actions).toContain("DASHBOARD_PERMISSIONS.REPORTS");
    for (const name of ["getGestionReport", "createSalonExpense", "updateSalonExpense", "deleteSalonExpense"]) {
      const body = actions.slice(actions.indexOf(`export async function ${name}`));
      expect(body.slice(0, 300)).toContain("requireGestionAccess()");
    }
  });

  it("soft-deletes charges", () => {
    expect(source("actions/dashboard/gestion.js")).not.toContain("salonExpense.delete(");
  });

  it("sits under Ventes & paiements for admins", () => {
    expect(source("components/dashboard/Layouts/sidebar/data/index.js")).toMatch(
      /title: "Gestion", url: "\/dashboard\/gestion", roles: \[ROLES\.OWNER, ROLES\.ADMIN\]/,
    );
  });
});
