import ExcelJS from "exceljs";

// Styling helpers mirror lib/recettes-excel.js (itself copied from
// lib/reports-excel.js) — duplicated rather than shared so tweaking this
// workbook can never regress the others, and vice versa.
const BRAND = {
  ink: "2F3A2E",
  gold: "B89664",
  cream: "F7F5F0",
  mist: "EEF1EC",
  white: "FFFFFF",
  slate: "58635A",
};

const currencyFormat = '#,##0.00 [$€-fr-BE]';

// Same convention as the on-screen journal (CaisseClient.jsx's
// NEGATIVE_DISPLAY_KINDS): a Dépense/Transfert de banque prints its amount
// as a negative figure rather than a plain positive one.
const NEGATIVE_DISPLAY_KINDS = new Set(["EXPENSE", "WITHDRAWAL"]);

function styleTitle(cell) {
  cell.font = { name: "Aptos Display", size: 18, bold: true, color: { argb: BRAND.white } };
  cell.alignment = { vertical: "middle" };
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BRAND.ink } };
}

function styleSection(cell) {
  cell.font = { name: "Aptos", size: 11, bold: true, color: { argb: BRAND.white } };
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BRAND.gold } };
  cell.alignment = { vertical: "middle" };
}

function styleHeader(row) {
  row.eachCell((cell) => {
    cell.font = { name: "Aptos", size: 10, bold: true, color: { argb: BRAND.white } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BRAND.ink } };
    cell.alignment = { vertical: "middle", wrapText: true };
    cell.border = { bottom: { style: "medium", color: { argb: BRAND.gold } } };
  });
  row.height = 28;
}

function styleDataRows(sheet, startRow, endRow, moneyColumns = []) {
  for (let rowNumber = startRow; rowNumber <= endRow; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    row.eachCell((cell) => {
      cell.font = { name: "Aptos", size: 10, color: { argb: "263128" } };
      cell.alignment = { vertical: "middle" };
      cell.border = { bottom: { style: "hair", color: { argb: "D7DDD7" } } };
      if (rowNumber % 2 === 0) {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BRAND.cream } };
      }
    });
    for (const column of moneyColumns) row.getCell(column).numFmt = currencyFormat;
  }
}

function addWorkbookHeader(sheet, { title, subtitle, columns }) {
  const lastColumn = String.fromCharCode(64 + columns);
  sheet.mergeCells(`A1:${lastColumn}1`);
  sheet.getCell("A1").value = title;
  styleTitle(sheet.getCell("A1"));
  sheet.getRow(1).height = 34;

  sheet.mergeCells(`A2:${lastColumn}2`);
  sheet.getCell("A2").value = subtitle;
  sheet.getCell("A2").font = { name: "Aptos", size: 10, italic: true, color: { argb: BRAND.slate } };
  sheet.getCell("A2").alignment = { vertical: "middle" };
  sheet.getRow(2).height = 22;
  sheet.views = [{ state: "frozen", ySplit: 3 }];
}

function addTable(sheet, { startRow, headers, rows, moneyColumns = [], widths = [] }) {
  const header = sheet.getRow(startRow);
  headers.forEach((value, index) => {
    header.getCell(index + 1).value = value;
  });
  styleHeader(header);

  rows.forEach((values, index) => {
    const row = sheet.getRow(startRow + index + 1);
    values.forEach((value, column) => {
      row.getCell(column + 1).value = value;
    });
  });
  styleDataRows(sheet, startRow + 1, startRow + rows.length, moneyColumns);
  sheet.autoFilter = { from: { row: startRow, column: 1 }, to: { row: startRow + rows.length, column: headers.length } };
  widths.forEach((width, index) => {
    sheet.getColumn(index + 1).width = width;
  });
}

/**
 * Build the styled workbook served by the private Livre de caisse download
 * route — two sheets, same shape as the Livre de recettes' own: "Synthèse"
 * (totals, category and VAT breakdown with transaction counts, cash
 * reconciliation, a period-over-period comparison, and per-session detail —
 * all cash-only, see lib/cash-book/build-day-report.js) and "Journal" (the
 * day-by-day ledger, entrées/sorties/solde).
 */
export async function buildCashBookWorkbook({ ledger, report }) {
  const { filters, totals, rows } = ledger;

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Meri Beauty";
  workbook.created = new Date();
  workbook.modified = new Date();
  workbook.properties.title = "Livre de caisse — Meri Beauty";
  workbook.properties.subject = "Journal chronologique de caisse, espèces uniquement";

  const subtitle = `Du ${filters.from} au ${filters.to} · Exporté le ${new Date().toLocaleString("fr-BE")}`;

  // ── Synthèse ────────────────────────────────────────────────────────────
  const synth = workbook.addWorksheet("Synthèse", { properties: { tabColor: { argb: BRAND.ink } } });
  addWorkbookHeader(synth, { title: "Livre de caisse", subtitle, columns: 4 });

  synth.mergeCells("A4:D4");
  synth.getCell("A4").value = "INDICATEURS CLÉS";
  styleSection(synth.getCell("A4"));
  synth.getRow(4).height = 22;
  [
    ["Total entrées", totals.entrees],
    ["Total sorties", totals.sorties],
    ["Solde", totals.finalBalance],
    ["Nombre d'écritures", rows.length],
  ].forEach(([label, value], index) => {
    const row = synth.getRow(index + 5);
    row.getCell(1).value = label;
    row.getCell(2).value = value;
    row.getCell(1).font = { name: "Aptos", size: 11, bold: true, color: { argb: BRAND.ink } };
    row.getCell(2).font = { name: "Aptos", size: 11, bold: true, color: { argb: BRAND.ink } };
    if (label !== "Nombre d'écritures") row.getCell(2).numFmt = currencyFormat;
    row.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: BRAND.mist } };
    row.getCell(2).fill = { type: "pattern", pattern: "solid", fgColor: { argb: BRAND.cream } };
  });

  let nextRow = 10;
  if (report) {
    const categoryRows = Object.entries(report.byCategory);

    synth.mergeCells(`A${nextRow}:D${nextRow}`);
    synth.getCell(`A${nextRow}`).value = "VENTES ESPÈCES PAR CATÉGORIE";
    styleSection(synth.getCell(`A${nextRow}`));
    synth.getRow(nextRow).height = 22;
    nextRow += 1;
    addTable(synth, {
      startRow: nextRow,
      headers: ["Catégorie", "Nb", "Net (€)"],
      rows: categoryRows.length
        ? categoryRows.map(([label, net]) => [label, report.byCategoryCounts?.[label] ?? 0, net])
        : [["Aucune vente en espèces", 0, 0]],
      moneyColumns: [3],
      widths: [28, 8, 18],
    });
    nextRow += (categoryRows.length || 1) + 2;

    synth.mergeCells(`A${nextRow}:D${nextRow}`);
    synth.getCell(`A${nextRow}`).value = "TVA SUR LES VENTES ESPÈCES";
    styleSection(synth.getCell(`A${nextRow}`));
    synth.getRow(nextRow).height = 22;
    nextRow += 1;
    addTable(synth, {
      startRow: nextRow,
      headers: ["Taux", "Nb", "Base HT (€)", "TVA (€)", "Total TTC (€)"],
      rows: report.byVatRate.length
        ? report.byVatRate.map((r) => [`${r.rate}%`, r.count, r.netAmount, r.vatAmount, r.grossAmount])
        : [["—", 0, 0, 0, 0]],
      moneyColumns: [3, 4, 5],
      widths: [12, 8, 16, 16, 16],
    });
    nextRow += (report.byVatRate.length || 1) + 2;

    synth.mergeCells(`A${nextRow}:D${nextRow}`);
    synth.getCell(`A${nextRow}`).value = "RÉCONCILIATION CAISSE";
    styleSection(synth.getCell(`A${nextRow}`));
    synth.getRow(nextRow).height = 22;
    nextRow += 1;
    addTable(synth, {
      startRow: nextRow,
      headers: ["Poste", "Montant (€)"],
      rows: [
        ["Mouvements — apports", report.cashMovements.in],
        ["Mouvements — sorties", -report.cashMovements.out],
        ...(report.expectedCash != null ? [["Attendu en caisse", report.expectedCash]] : []),
      ],
      moneyColumns: [2],
      widths: [28, 18],
    });
    nextRow += 3 + (report.expectedCash != null ? 1 : 0) + 2;

    if (report.sessions.length > 0) {
      synth.mergeCells(`A${nextRow}:D${nextRow}`);
      synth.getCell(`A${nextRow}`).value = "SESSIONS DE CAISSE";
      styleSection(synth.getCell(`A${nextRow}`));
      synth.getRow(nextRow).height = 22;
      nextRow += 1;
      addTable(synth, {
        startRow: nextRow,
        headers: ["Ouverture", "Clôture", "Fond initial (€)", "Compté (€)", "Écart (€)", "Type"],
        rows: report.sessions.map((s) => [
          new Date(s.openedAt).toLocaleString("fr-BE", { timeZone: "Europe/Brussels" }),
          s.closedAt ? new Date(s.closedAt).toLocaleString("fr-BE", { timeZone: "Europe/Brussels" }) : "En cours",
          s.openingFloat,
          s.countedCash ?? "",
          s.variance ?? "",
          !s.closedAt ? "" : s.isAutoClosed ? "Auto" : "Manuel",
        ]),
        moneyColumns: [3, 4, 5],
        widths: [20, 20, 16, 16, 14, 10],
      });
    }
  }

  // ── Journal ─────────────────────────────────────────────────────────────
  const journal = workbook.addWorksheet("Journal", { properties: { tabColor: { argb: BRAND.gold } } });
  addWorkbookHeader(journal, { title: "Journal de caisse", subtitle, columns: 7 });
  addTable(journal, {
    startRow: 4,
    headers: ["Date", "N° pièce", "Référence", "Désignation", "Entrées (€)", "Sorties (€)", "Solde (€)"],
    rows: rows.map((row) => [
      new Date(row.date).toLocaleString("fr-BE", { timeZone: "Europe/Brussels" }),
      row.pieceNumber ?? "",
      row.reference ?? "",
      row.label,
      row.entree || "",
      row.sortie ? (NEGATIVE_DISPLAY_KINDS.has(row.kind) ? -row.sortie : row.sortie) : "",
      row.solde,
    ]),
    moneyColumns: [5, 6, 7],
    widths: [20, 14, 16, 40, 14, 14, 14],
  });

  return Buffer.from(await workbook.xlsx.writeBuffer());
}
