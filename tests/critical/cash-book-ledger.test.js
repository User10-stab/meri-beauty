import { describe, expect, it, vi } from "vitest";
import { buildCashBookLedger } from "@/lib/cash-book/build-ledger";

/**
 * A minimal mocked Prisma-shaped client, in the same style as
 * product-order-refund-reconciliation.test.js — buildCashBookLedger is pure
 * given a client, so it is tested directly against fakes instead of a real
 * database.
 */
function clientMock({ session, transactions = [], movements = [] }) {
  return {
    cashSession: { findUnique: vi.fn().mockResolvedValue(session) },
    transaction: { findMany: vi.fn().mockResolvedValue(transactions) },
    cashMovement: { findMany: vi.fn().mockResolvedValue(movements) },
  };
}

const BASE_SESSION = {
  id: "sess_1",
  openedAt: new Date("2026-08-01T08:00:00Z"),
  closedAt: null,
  openingFloat: 500,
};

describe("buildCashBookLedger", () => {
  it("returns null for a session that does not exist", async () => {
    const client = clientMock({ session: null });
    const result = await buildCashBookLedger(client, "missing");
    expect(result).toBeNull();
  });

  it("opens the ledger with the opening float as the first row", async () => {
    const client = clientMock({ session: BASE_SESSION });
    const result = await buildCashBookLedger(client, "sess_1");
    expect(result.rows[0]).toMatchObject({ kind: "OPENING", label: "Solde initial", entree: 500, sortie: 0, solde: 500 });
  });

  // Mirrors the example cash book: two produit sales, two expenses, running
  // balance 500 -> 680 -> 775 -> 750 -> 720.
  it("computes a running balance across sales and expenses, in chronological order", async () => {
    const client = clientMock({
      session: BASE_SESSION,
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

    const result = await buildCashBookLedger(client, "sess_1");
    const soldes = result.rows.map((r) => r.solde);
    expect(soldes).toEqual([500, 680, 775, 750, 720]);
    expect(result.totals).toEqual({ entrees: 275, sorties: 55, finalBalance: 720 });
  });

  it("labels a sale by its payment source — order, appointment, atelier, événement, formation", async () => {
    const client = clientMock({
      session: BASE_SESSION,
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

    const result = await buildCashBookLedger(client, "sess_1");
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
      session: BASE_SESSION,
      transactions: [
        {
          transactionType: "REFUND",
          amount: 40,
          paidAt: new Date("2026-08-01T11:00:00Z"),
          pieceNumber: "V0003",
          payment: { invoice: { number: "2026-000041" }, order: { orderNumber: 14 } },
        },
      ],
    });

    const result = await buildCashBookLedger(client, "sess_1");
    const row = result.rows[1];
    expect(row).toMatchObject({
      kind: "REFUND",
      label: "Remboursement — Vente produits — commande n°14",
      reference: "2026-000041",
      entree: 0,
      sortie: 40,
      solde: 460,
    });
  });

  it("CASH_IN movements are entrées, EXPENSE and WITHDRAWAL are sorties", async () => {
    const client = clientMock({
      session: BASE_SESSION,
      movements: [
        { type: "CASH_IN", amount: 20, occurredAt: new Date("2026-08-01T09:00:00Z"), pieceNumber: "X0001", label: "Appoint" },
        { type: "WITHDRAWAL", amount: 100, occurredAt: new Date("2026-08-01T09:01:00Z"), pieceNumber: "X0002", label: "Dépôt banque" },
      ],
    });

    const result = await buildCashBookLedger(client, "sess_1");
    expect(result.rows[1]).toMatchObject({ entree: 20, sortie: 0, solde: 520 });
    expect(result.rows[2]).toMatchObject({ entree: 0, sortie: 100, solde: 420 });
  });

  it("only queries CASH transactions with a piece number — CARD/ONLINE rows never belong in this drawer's book", async () => {
    const client = clientMock({ session: BASE_SESSION });
    await buildCashBookLedger(client, "sess_1");
    expect(client.transaction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ method: "CASH", pieceNumber: { not: null } }),
      })
    );
  });

  // A sale already carrying a legal Invoice is tracked through that
  // Invoice's own record and the Opérations page — deliberately excluded
  // here so the same money is never represented twice in this ledger.
  it("excludes any sale whose payment already has an invoice, from the query itself", async () => {
    const client = clientMock({ session: BASE_SESSION });
    await buildCashBookLedger(client, "sess_1");
    expect(client.transaction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ payment: { invoice: null } }),
      })
    );
  });
});
