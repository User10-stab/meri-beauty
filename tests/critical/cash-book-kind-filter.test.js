import { describe, expect, it } from "vitest";
import { applyCashBookKindFilter, cashBookFileBaseName, normalizeCashBookKind } from "@/lib/cash-book/filters";

/**
 * The Livre de caisse "Afficher" filter (3 Nov 2026): narrows the journal to
 * apports and/or dépenses, for the screen and all three exports alike.
 */
const ledger = {
  sessions: [],
  rows: [
    { kind: "OPENING", date: "2026-11-02T08:00:00Z", entree: 100, sortie: 0, solde: 100 },
    { kind: "SALE", date: "2026-11-02T09:00:00Z", entree: 50, sortie: 0, solde: 150 },
    { kind: "CASH_IN", date: "2026-11-02T10:00:00Z", entree: 20, sortie: 0, solde: 170 },
    { kind: "EXPENSE", date: "2026-11-02T11:00:00Z", entree: 0, sortie: 12.5, solde: 157.5 },
    { kind: "WITHDRAWAL", date: "2026-11-02T12:00:00Z", entree: 0, sortie: 100, solde: 57.5 },
    { kind: "REFUND", date: "2026-11-02T13:00:00Z", entree: 0, sortie: 10, solde: 47.5 },
  ],
  totals: { entrees: 70, sorties: 122.5, finalBalance: 47.5 },
};

describe("Livre de caisse — apports/dépenses filter", () => {
  it("returns the ledger untouched with no filter", () => {
    expect(applyCashBookKindFilter(ledger, null)).toBe(ledger);
  });

  it("keeps only apports and dépenses, with a running net from zero", () => {
    const filtered = applyCashBookKindFilter(ledger, "MOVEMENTS");
    expect(filtered.rows.map((r) => r.kind)).toEqual(["CASH_IN", "EXPENSE"]);
    expect(filtered.rows.map((r) => r.solde)).toEqual([20, 7.5]);
    expect(filtered.totals).toEqual({ entrees: 20, sorties: 12.5, finalBalance: 7.5 });
  });

  it("can show apports alone or dépenses alone", () => {
    expect(applyCashBookKindFilter(ledger, "CASH_IN").rows.map((r) => r.kind)).toEqual(["CASH_IN"]);
    const expenses = applyCashBookKindFilter(ledger, "EXPENSE");
    expect(expenses.rows.map((r) => r.kind)).toEqual(["EXPENSE"]);
    expect(expenses.totals).toEqual({ entrees: 0, sorties: 12.5, finalBalance: -12.5 });
  });

  it("shows transferts de banque on their own, never inside apports & dépenses", () => {
    const transfers = applyCashBookKindFilter(ledger, "WITHDRAWAL");
    expect(transfers.rows.map((r) => r.kind)).toEqual(["WITHDRAWAL"]);
    expect(transfers.rows.map((r) => r.solde)).toEqual([-100]);
    expect(transfers.totals).toEqual({ entrees: 0, sorties: 100, finalBalance: -100 });
    expect(applyCashBookKindFilter(ledger, "MOVEMENTS").rows.some((r) => r.kind === "WITHDRAWAL")).toBe(false);
  });

  it("treats an unknown URL value as no filter", () => {
    expect(normalizeCashBookKind("SALE")).toBeNull();
    expect(normalizeCashBookKind(undefined)).toBeNull();
    expect(normalizeCashBookKind("EXPENSE")).toBe("EXPENSE");
  });

  it("names the export files after the filter", () => {
    expect(cashBookFileBaseName({ from: "2026-11-01", to: "2026-11-03", type: null })).toBe("livre-de-caisse-2026-11-01_2026-11-03");
    expect(cashBookFileBaseName({ from: "2026-11-01", to: "2026-11-03", type: "MOVEMENTS" })).toBe(
      "livre-de-caisse-2026-11-01_2026-11-03-apports-depenses"
    );
  });
});
