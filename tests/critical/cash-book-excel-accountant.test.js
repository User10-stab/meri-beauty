import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { buildCashBookWorkbook } from "@/lib/cash-book-excel";
import { applyCashBookKindFilter } from "@/lib/cash-book/filters";

/**
 * The Excel export goes to the accountant: its Journal must reconcile on its
 * own — SUM(Entrées)/SUM(Sorties) equal the Synthèse totals and each Solde
 * equals the previous one + entrée − sortie. Sorties are therefore positive
 * here even though the screen/PDF print dépenses and transferts negative.
 */
const ledger = {
  filters: { from: "2026-10-01", to: "2026-11-03", type: null },
  rows: [
    { kind: "SALE", date: "2026-10-02T07:00:00Z", pieceNumber: "T1", label: "Vente", entree: 1349.94, sortie: 0, solde: 1349.94, amountHt: 1115.65, amountVat: 234.29, vatRate: 21 },
    { kind: "WITHDRAWAL", date: "2026-10-02T08:11:00Z", pieceNumber: "X0001", label: "Transfert", entree: 0, sortie: 1700, solde: -350.06 },
    { kind: "EXPENSE", date: "2026-10-05T09:00:00Z", pieceNumber: "D0001", label: "Dépense", entree: 0, sortie: 20, solde: -370.06 },
    { kind: "REFUND", date: "2026-10-10T15:46:00Z", pieceNumber: "T2", label: "Remboursement", entree: 0, sortie: 12.5, solde: -382.56, amountHt: -10.33, amountVat: -2.17, vatRate: 21 },
  ],
  totals: { entrees: 1349.94, sorties: 1732.5, finalBalance: -382.56 },
};

async function journalOf(view) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await buildCashBookWorkbook({ ledger: view, report: null }));
  const sheet = workbook.getWorksheet("Journal");
  const headers = sheet.getRow(4).values;
  const column = (name) => headers.findIndex((h) => typeof h === "string" && h.startsWith(name));
  const rows = [];
  for (let n = 5; n <= sheet.rowCount; n += 1) rows.push(sheet.getRow(n).values);
  const num = (value) => (typeof value === "number" ? value : 0);
  return {
    date: rows.map((r) => r[1]),
    entrees: rows.map((r) => num(r[column("Entrées")])),
    sorties: rows.map((r) => num(r[column("Sorties")])),
    soldes: rows.map((r) => num(r[column("Solde")] ?? r[column("Cumul")])),
  };
}

const sum = (values) => Math.round(values.reduce((a, b) => a + b, 0) * 100) / 100;

describe("Livre de caisse Excel — accountant reconciliation", () => {
  it("full journal: unsigned Sorties that sum to the total and chain the Solde", async () => {
    const journal = await journalOf(ledger);
    expect(journal.sorties.every((v) => v >= 0)).toBe(true);
    expect(sum(journal.entrees)).toBe(ledger.totals.entrees);
    expect(sum(journal.sorties)).toBe(ledger.totals.sorties);
    let solde = 0;
    journal.soldes.forEach((value, i) => {
      solde = Math.round((solde + journal.entrees[i] - journal.sorties[i]) * 100) / 100;
      expect(value).toBe(solde);
    });
  });

  it("writes real Excel dates at Brussels wall-clock time", async () => {
    const journal = await journalOf(ledger);
    expect(journal.date[0]).toBeInstanceOf(Date);
    // 07:00 UTC on 2 Oct 2026 is 09:00 in Brussels (CEST).
    expect(journal.date[0].toISOString()).toBe("2026-10-02T09:00:00.000Z");
  });

  it("transferts view: positive Sorties, Cumul chained, total matches the column", async () => {
    const view = { ...applyCashBookKindFilter(ledger, "WITHDRAWAL"), filters: { ...ledger.filters, type: "WITHDRAWAL" } };
    const journal = await journalOf(view);
    expect(journal.sorties).toEqual([1700]);
    expect(sum(journal.sorties)).toBe(view.totals.sorties);
    expect(journal.soldes).toEqual([-1700]);
  });
});
