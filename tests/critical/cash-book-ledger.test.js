import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildCashBookLedger } from "@/lib/cash-book/build-ledger";
import { groupLedgerRowsByDay } from "@/lib/cash-book/day-groups";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8").replace(/\r\n/g, "\n");

/**
 * A minimal mocked Prisma-shaped client, in the same style as
 * product-order-refund-reconciliation.test.js — buildCashBookLedger is pure
 * given a client, so it is tested directly against fakes instead of a real
 * database. Since the 11 Sep 2026 redesign the ledger spans a date range
 * (possibly several sessions), not one sessionId — `sessions` replaces the
 * old single `session`.
 */
function clientMock({ sessions = [], transactions = [], movements = [] }) {
  return {
    cashSession: { findMany: vi.fn().mockResolvedValue(sessions) },
    transaction: { findMany: vi.fn().mockResolvedValue(transactions) },
    cashMovement: { findMany: vi.fn().mockResolvedValue(movements) },
  };
}

const BASE_SESSION = {
  id: "sess_1",
  openedAt: new Date("2026-08-01T08:00:00Z"),
  closedAt: null,
  openingFloat: 500,
  isAutoOpened: false,
  isAutoClosed: false,
};

const RANGE = { fromDate: new Date("2026-08-01T00:00:00"), toDate: new Date("2026-08-01T23:59:59.999") };

describe("buildCashBookLedger", () => {
  it("returns an empty ledger when no session falls in the range", async () => {
    const client = clientMock({ sessions: [] });
    const result = await buildCashBookLedger(client, RANGE);
    expect(result).toEqual({ sessions: [], rows: [], totals: { entrees: 0, sorties: 0, finalBalance: 0 } });
  });

  it("opens the ledger with the opening float as the first row", async () => {
    const client = clientMock({ sessions: [BASE_SESSION] });
    const result = await buildCashBookLedger(client, RANGE);
    expect(result.rows[0]).toMatchObject({ kind: "OPENING", label: "Solde initial", entree: 500, sortie: 0, solde: 500 });
  });

  // With more than one session in range, each OPENING row is dated so the
  // reader can tell which day's balance it started — see sessionOpeningRow.
  it("labels each session's opening row with its date when several sessions fall in the range", async () => {
    const client = clientMock({
      sessions: [
        BASE_SESSION,
        { id: "sess_2", openedAt: new Date("2026-08-02T09:00:00Z"), closedAt: null, openingFloat: 720, isAutoOpened: true, isAutoClosed: false },
      ],
    });
    const result = await buildCashBookLedger(client, {
      fromDate: new Date("2026-08-01T00:00:00"),
      toDate: new Date("2026-08-02T23:59:59.999"),
    });
    const openingRows = result.rows.filter((r) => r.kind === "OPENING");
    expect(openingRows).toHaveLength(2);
    expect(openingRows[0].label).toMatch(/^Solde initial — /);
    expect(openingRows[1].label).toMatch(/^Solde initial — /);
    // The second session's float already carries the first session's
    // countedCash forward — the running balance is continuous, not reset.
    expect(result.rows.map((r) => r.solde)).toEqual([500, 1220]);
  });

  // Mirrors the example cash book: two produit sales, two expenses, running
  // balance 500 -> 680 -> 775 -> 750 -> 720.
  it("computes a running balance across sales and expenses, in chronological order", async () => {
    const client = clientMock({
      sessions: [BASE_SESSION],
      transactions: [
        {
          transactionType: "FINAL_PAYMENT",
          amount: 180,
          paidAt: new Date("2026-08-01T09:00:00Z"),
          pieceNumber: "V0001",
          payment: { invoice: null, order: { orderNumber: 12 } },
        },
        {
          transactionType: "FINAL_PAYMENT",
          amount: 95,
          paidAt: new Date("2026-08-01T09:30:00Z"),
          pieceNumber: "V0002",
          payment: { invoice: null, order: { orderNumber: 13 } },
        },
      ],
      movements: [
        { type: "EXPENSE", amount: 25, occurredAt: new Date("2026-08-01T10:00:00Z"), pieceNumber: "D0001", label: "Achat petits emballages" },
        { type: "EXPENSE", amount: 30, occurredAt: new Date("2026-08-01T10:30:00Z"), pieceNumber: "D0002", label: "Frais de livraison" },
      ],
    });

    const result = await buildCashBookLedger(client, RANGE);
    const soldes = result.rows.map((r) => r.solde);
    expect(soldes).toEqual([500, 680, 775, 750, 720]);
    expect(result.totals).toEqual({ entrees: 275, sorties: 55, finalBalance: 720 });
  });

  it("labels a sale by its payment source — order, appointment, atelier, événement, formation", async () => {
    const client = clientMock({
      sessions: [BASE_SESSION],
      transactions: [
        {
          transactionType: "FINAL_PAYMENT",
          amount: 10,
          paidAt: new Date("2026-08-01T09:00:00Z"),
          pieceNumber: "V0001",
          payment: { invoice: null, order: { orderNumber: 1 } },
        },
        {
          transactionType: "FINAL_PAYMENT",
          amount: 10,
          paidAt: new Date("2026-08-01T09:01:00Z"),
          pieceNumber: "R0001",
          payment: { invoice: null, appointment: { staffService: { service: { name: "Manucure" } } } },
        },
        {
          transactionType: "FINAL_PAYMENT",
          amount: 10,
          paidAt: new Date("2026-08-01T09:02:00Z"),
          pieceNumber: "A0001",
          payment: {
            invoice: null,
            workshopReservation: { session: { workshop: { title: "Maquillage express", type: "WORKSHOP" } } },
          },
        },
        {
          transactionType: "FINAL_PAYMENT",
          amount: 10,
          paidAt: new Date("2026-08-01T09:03:00Z"),
          pieceNumber: "E0001",
          payment: {
            invoice: null,
            workshopReservation: { session: { workshop: { title: "Soirée VIP", type: "EVENT" } } },
          },
        },
        {
          transactionType: "FINAL_PAYMENT",
          amount: 10,
          paidAt: new Date("2026-08-01T09:04:00Z"),
          pieceNumber: "F0001",
          payment: { invoice: null, formationReservation: { session: { formation: { title: "Extension de cils" } } } },
        },
      ],
    });

    const result = await buildCashBookLedger(client, RANGE);
    const labels = result.rows.slice(1).map((r) => r.label);
    expect(labels).toEqual([
      "Vente produits — commande n°1",
      "Rendez-vous — Manucure",
      "Atelier — Maquillage express",
      "Événement — Soirée VIP",
      "Formation — Extension de cils",
    ]);
  });

  it("a refund reduces the balance and is prefixed, using the same invoice reference as the sale", async () => {
    const client = clientMock({
      sessions: [BASE_SESSION],
      transactions: [
        {
          id: "refund-1",
          transactionType: "REFUND",
          amount: 40,
          paidAt: new Date("2026-08-01T11:00:00Z"),
          pieceNumber: "V0003",
          payment: { id: "pay-14", invoice: { number: "2026-000041" }, order: { id: "order-14", orderNumber: 14 } },
        },
      ],
    });

    const result = await buildCashBookLedger(client, RANGE);
    const row = result.rows[1];
    expect(row).toMatchObject({
      kind: "REFUND",
      label: "Remboursement — Vente produits — commande n°14",
      reference: "2026-000041",
      entree: 0,
      sortie: 40,
      solde: 460,
      // transactionToRow does not branch on isRefund for these — a REFUND
      // row needs the exact same trail back to its ticket as a SALE row.
      transactionId: "refund-1",
      paymentId: "pay-14",
      orderId: "order-14",
    });
  });

  it("CASH_IN movements are entrées, EXPENSE and WITHDRAWAL are sorties", async () => {
    const client = clientMock({
      sessions: [BASE_SESSION],
      movements: [
        { type: "CASH_IN", amount: 20, occurredAt: new Date("2026-08-01T09:00:00Z"), pieceNumber: "X0001", label: "Appoint" },
        { type: "WITHDRAWAL", amount: 100, occurredAt: new Date("2026-08-01T09:01:00Z"), pieceNumber: "X0002", label: "Transfert de banque" },
      ],
    });

    const result = await buildCashBookLedger(client, RANGE);
    expect(result.rows[1]).toMatchObject({ entree: 20, sortie: 0, solde: 520 });
    expect(result.rows[2]).toMatchObject({ entree: 0, sortie: 100, solde: 420 });
  });

  it("only queries CASH transactions with a piece number, within the range — CARD/ONLINE rows never belong in this drawer's book", async () => {
    const client = clientMock({ sessions: [BASE_SESSION] });
    await buildCashBookLedger(client, RANGE);
    expect(client.transaction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          method: "CASH",
          pieceNumber: { not: null },
          paidAt: { gte: RANGE.fromDate, lte: RANGE.toDate },
        }),
      })
    );
  });

  // An invoice is a separate legal record of the sale (see the Opérations
  // page), but the cash it was paid in is still physically in the drawer —
  // the query must not carry an `invoice: null` condition that would drop
  // it from this ledger.
  it("does not filter on whether the payment has an invoice", async () => {
    const client = clientMock({ sessions: [BASE_SESSION] });
    await buildCashBookLedger(client, RANGE);
    const { where } = client.transaction.findMany.mock.calls[0][0];
    expect(where).not.toHaveProperty("payment");
  });

  it("includes an invoiced (B2B) cash sale in the ledger and its running balance", async () => {
    const client = clientMock({
      sessions: [BASE_SESSION],
      transactions: [
        {
          transactionType: "FINAL_PAYMENT",
          amount: 200,
          paidAt: new Date("2026-08-01T09:00:00Z"),
          pieceNumber: "V0001",
          payment: { invoice: { number: "2026-000050" }, order: { orderNumber: 20 } },
        },
      ],
    });

    const result = await buildCashBookLedger(client, RANGE);
    expect(result.rows[1]).toMatchObject({
      kind: "SALE",
      label: "Vente produits — commande n°20",
      entree: 200,
      solde: 700,
    });
    expect(result.totals).toEqual({ entrees: 200, sorties: 0, finalBalance: 700 });
  });

  // These ids are never displayed directly — they're what
  // CaisseClient.jsx's pieceNumberHref uses to link N° pièce to the
  // transaction's actual ticket.
  // transaction.id and payment.id are already present on the raw Prisma row
  // (the query includes payment rather than selecting it), so carrying them
  // onto the returned row is a reshape, not a new query.
  it("carries transactionId/paymentId/orderId on an order-backed sale, for linking to its ticket", async () => {
    const client = clientMock({
      sessions: [BASE_SESSION],
      transactions: [
        {
          id: "txn-1",
          transactionType: "FINAL_PAYMENT",
          amount: 10,
          paidAt: new Date("2026-08-01T09:00:00Z"),
          pieceNumber: "V0001",
          payment: { id: "pay-1", invoice: null, order: { id: "order-1", orderNumber: 1 } },
        },
      ],
    });
    const result = await buildCashBookLedger(client, RANGE);
    expect(result.rows[1]).toMatchObject({ transactionId: "txn-1", paymentId: "pay-1", orderId: "order-1" });
  });

  it("carries transactionId/paymentId but no orderId for a reservation-backed sale", async () => {
    const client = clientMock({
      sessions: [BASE_SESSION],
      transactions: [
        {
          id: "txn-2",
          transactionType: "FINAL_PAYMENT",
          amount: 10,
          paidAt: new Date("2026-08-01T09:00:00Z"),
          pieceNumber: "R0001",
          payment: { id: "pay-2", invoice: null, appointment: { staffService: null } },
        },
      ],
    });
    const result = await buildCashBookLedger(client, RANGE);
    expect(result.rows[1]).toMatchObject({ transactionId: "txn-2", paymentId: "pay-2", orderId: null });
  });

  it("a drawer movement carries no transaction/payment/order id — there is nothing to link", async () => {
    const client = clientMock({
      sessions: [BASE_SESSION],
      movements: [{ type: "EXPENSE", amount: 25, occurredAt: new Date("2026-08-01T10:00:00Z"), pieceNumber: "D0001", label: "Achat" }],
    });
    const result = await buildCashBookLedger(client, RANGE);
    expect(result.rows[1]).not.toHaveProperty("transactionId");
    expect(result.rows[1]).not.toHaveProperty("paymentId");
    expect(result.rows[1]).not.toHaveProperty("orderId");
  });
});

// pieceNumberHref (CaisseClient.jsx) is what actually turns these ids into
// the link a controller clicks — verified against source since it's plain
// UI logic with no server round trip of its own to exercise.
describe("N° pièce links to the ticket it produced", () => {
  const client = source("components/dashboard/boutique/caisse/CaisseClient.jsx");

  it("an order-backed row (SALE or REFUND) links to the order's ticket", () => {
    expect(client).toContain("if (row.orderId) return `/api/orders/${row.orderId}/ticket`;");
  });

  it("a SALE row for a reservation payment links to its exact collection, via transactionId", () => {
    expect(client).toContain(
      'if (row.paymentId && row.kind === "SALE") return `/api/payments/${row.paymentId}/ticket?transactionId=${row.transactionId}`;'
    );
  });

  it("a REFUND row for a reservation payment links to the payment's ticket without transactionId", () => {
    // collectionTicketFields rejects a REFUND transactionType, and the
    // payments-ticket route only ever queries DEPOSIT/FINAL_PAYMENT
    // collections — a REFUND's own transactionId can never resolve there.
    expect(client).toContain("if (row.paymentId) return `/api/payments/${row.paymentId}/ticket`;");
  });

  it("only SALE and REFUND rows are eligible — a drawer movement has no ticket", () => {
    expect(client).toContain('if (row.kind !== "SALE" && row.kind !== "REFUND") return null;');
  });
});

// 11 Sep 2026: the journal is grouped day by day (same collapsible pattern
// as lib/livre-de-recettes/day-groups.js's groupRowsByDay), each day ending
// in a bold "Total du jour" row — see CaisseClient.jsx's DayGroup.
describe("groupLedgerRowsByDay — powers the journal's collapsible day groups", () => {
  function ledgerRow(overrides = {}) {
    return { kind: "SALE", date: new Date("2026-08-10T10:00:00Z"), entree: 50, sortie: 0, solde: 150, ...overrides };
  }

  it("buckets rows into one group per Brussels-local calendar day", () => {
    const groups = groupLedgerRowsByDay([
      ledgerRow({ date: new Date("2026-08-10T08:00:00Z") }),
      ledgerRow({ date: new Date("2026-08-10T20:00:00Z") }),
      ledgerRow({ date: new Date("2026-08-11T08:00:00Z") }),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0].rows).toHaveLength(2);
    expect(groups[1].rows).toHaveLength(1);
  });

  it("sums a day's entrées/sorties across its rows and closes on the day's last running balance", () => {
    const groups = groupLedgerRowsByDay([
      ledgerRow({ entree: 100, sortie: 0, solde: 200 }),
      ledgerRow({ kind: "EXPENSE", entree: 0, sortie: 15, solde: 185 }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ totalEntrees: 100, totalSorties: 15, closingBalance: 185 });
  });
});
