import { describe, expect, test } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { reservationBalanceDue } from "@/lib/payments/collectible-balance";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8").replace(/\r\n/g, "\n");

// Prod, 01/10/2026: a formation paid in full (Total 2200 / Payé 2200 / « Payé »)
// still showed « Solde : 1540,00 € ». The reservation keeps the balance of the
// plan as booked; only the Payment row moves when the balance is collected.
describe("the balance shown on an atelier / formation reservation", () => {
  test("a fully paid payment owes nothing, whatever the reservation still says", () => {
    expect(
      reservationBalanceDue({ status: "COMPLETED", balanceDue: 1540, payment: { status: "PAID", remainingAmount: 0 } }),
    ).toBe(0);
  });

  test("an unpaid balance is still shown", () => {
    expect(
      reservationBalanceDue({ status: "CONFIRMED", balanceDue: 1540, payment: { status: "PARTIALLY_PAID", remainingAmount: "1540" } }),
    ).toBe(1540);
  });

  test("a cancelled or refunded booking owes nothing", () => {
    expect(
      reservationBalanceDue({ status: "CANCELLED", balanceDue: 40, payment: { status: "PARTIALLY_PAID", remainingAmount: 40 } }),
    ).toBe(0);
    expect(
      reservationBalanceDue({ status: "CONFIRMED", balanceDue: 40, payment: { status: "REFUNDED", remainingAmount: 40 } }),
    ).toBe(0);
  });

  test("without a payment row the reservation's own figure is the fallback", () => {
    expect(reservationBalanceDue({ status: "PENDING_DEPOSIT", balanceDue: "75.5", payment: null })).toBe(75.5);
  });

  test.each([
    "components/dashboard/formations/ReservationRow.jsx",
    "components/dashboard/workshops/ReservationRow.jsx",
  ])("%s reads the shared rule, not reservation.balanceDue", (path) => {
    const code = source(path);
    expect(code).toContain("reservationBalanceDue(row)");
    expect(code).not.toContain("row.balanceDue");
  });
});

// « Rapports » was folded into the dashboard home.
describe("the dashboard home carries what Rapports used to show", () => {
  test("the Rapports page, its export route and its menu entry are gone", () => {
    expect(existsSync(`${root}app/dashboard/reports/page.jsx`)).toBe(false);
    expect(existsSync(`${root}app/api/reports/export/route.js`)).toBe(false);
    expect(source("components/dashboard/Layouts/sidebar/data/index.js")).not.toContain("/dashboard/reports");
  });

  test("top products, activity split and cash-vs-bank are computed for admins only", () => {
    const action = source("actions/dashboard/get-dashboard-stats.js");
    for (const key of ["topProducts", "revenueBySource", "collectionByMethod", "cashCollected", "bankCollected"]) {
      expect(action).toContain(key);
    }
    expect(action).toContain("isAdmin ? prisma.transaction.groupBy(");
    expect(action).toContain("isAdmin ? prisma.orderItem.groupBy(");
    expect(action).toContain("payment: SALON_PAYMENT_WHERE");

    const page = source("app/dashboard/page.jsx");
    expect(page).toContain("Meilleures ventes (produits)");
    expect(page).toContain("Répartition par activité");
    expect(page).toContain("{showFilters && (\n        <div className=\"grid grid-cols-1 gap-4 xl:grid-cols-3\">");
  });
});

// Prod, Sept 2026: the dashboard said 7 323,30 € and the livre de recettes
// 7 308,30 €. A card sale of 15 € paid on 29 Aug was refunded on 23 Sept; the
// dashboard picked payments by their own date, so that refund fell into no
// month. Revenue is now the livre's basis: ledger entries by the day the money
// moved, a refund being negative.
describe("the dashboard revenue ties to the livre de recettes", () => {
  test("it sums Transaction rows of the month, not Payment rows", () => {
    const action = source("actions/dashboard/get-dashboard-stats.js");
    expect(action).toContain("prisma.transaction.findMany({");
    expect(action).toContain("payment: SALON_PAYMENT_WHERE,");
    expect(action).toContain('transaction.transactionType === "REFUND" ? -amount : amount');
    expect(action).not.toContain("summarizePaymentAmounts");
    expect(action).not.toContain("monthPayments");
  });
});
