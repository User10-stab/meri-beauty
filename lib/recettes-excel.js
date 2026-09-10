import ExcelJS from "exceljs";

// Styling helpers mirror lib/reports-excel.js. Copied rather than shared so
// tweaking the recettes workbook can never regress the working reports
// export, and vice versa.
const BRAND = {
  ink: "2F3A2E",
  gold: "B89664",
  cream: "F7F5F0",
  mist: "EEF1EC",
  white: "FFFFFF",
  slate: "58635A",
};

const currencyFormat = '#,##0.00 [$€-fr-BE]';

const TYPE_LABELS = {
  DEPOSIT: "Acompte",
  FINAL_PAYMENT: "Solde",
  REFUND: "Remboursement",
};

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

function formatVatRate(rate) {
  return rate == null ? "Taux inconnu" : `${rate} %`;
}

/** Build the styled workbook served by the private recettes download route. */
export async function buildRecettesWorkbook(data) {
  const { filters, summary, rows } = data;

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Meri Beauty";
  workbook.created = new Date();
  workbook.modified = new Date();
  workbook.properties.title = "Livre de recettes — Meri Beauty";
  workbook.properties.subject = "Journal chronologique des recettes, tous moyens de paiement";

  const subtitle = `Du ${filters.from} au ${filters.to} · ${filters.methodLabel} · ${filters.categoryLabel} · Exporté le ${new Date().toLocaleString("fr-BE")}`;

  // ── Synthèse ────────────────────────────────────────────────────────────
  const synth = workbook.addWorksheet("Synthèse", { properties: { tabColor: { argb: BRAND.ink } } });
  addWorkbookHeader(synth, { title: "Livre de recettes", subtitle, columns: 4 });

  synth.mergeCells("A4:D4");
  synth.getCell("A4").value = "INDICATEURS CLÉS";
  styleSection(synth.getCell("A4"));
  synth.getRow(4).height = 22;
  [
    ["Total net des recettes", summary.total],
    ["Recettes brutes", summary.grossInflow],
    ["Remboursements", summary.refundTotal],
    ["Nombre d'écritures", summary.count],
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

  synth.mergeCells("A10:D10");
  synth.getCell("A10").value = "PAR MOYEN DE PAIEMENT";
  styleSection(synth.getCell("A10"));
  synth.getRow(10).height = 22;
  addTable(synth, {
    startRow: 11,
    headers: ["Moyen de paiement", "Net (€)", "Remboursé (€)"],
    rows: summary.byMethod.map((m) => [m.label, m.net, m.refunded]),
    moneyColumns: [2, 3],
    widths: [28, 18, 18, 18],
  });

  const catStart = 11 + summary.byMethod.length + 2;
  synth.mergeCells(`A${catStart}:D${catStart}`);
  synth.getCell(`A${catStart}`).value = "PAR CATÉGORIE";
  styleSection(synth.getCell(`A${catStart}`));
  synth.getRow(catStart).height = 22;
  addTable(synth, {
    startRow: catStart + 1,
    headers: ["Catégorie", "Net (€)"],
    rows: summary.byCategory.map((c) => [c.label, c.net]),
    moneyColumns: [2],
    widths: [28, 18],
  });

  const vatStart = catStart + 1 + summary.byCategory.length + 2;
  synth.mergeCells(`A${vatStart}:D${vatStart}`);
  synth.getCell(`A${vatStart}`).value = "PAR TAUX DE TVA";
  styleSection(synth.getCell(`A${vatStart}`));
  synth.getRow(vatStart).height = 22;
  addTable(synth, {
    startRow: vatStart + 1,
    headers: ["Taux", "Base HT (€)", "TVA (€)", "TTC (€)"],
    rows: summary.byVatRate.map((v) => [formatVatRate(v.rate), v.netAmount, v.vatAmount, v.grossAmount]),
    moneyColumns: [2, 3, 4],
    widths: [16, 18, 18, 18],
  });

  // ── Journal ─────────────────────────────────────────────────────────────
  const journal = workbook.addWorksheet("Journal", { properties: { tabColor: { argb: BRAND.gold } } });
  addWorkbookHeader(journal, { title: "Journal des recettes", subtitle, columns: 11 });
  addTable(journal, {
    startRow: 4,
    headers: [
      "Date",
      "Pièce",
      "Référence",
      "Client",
      "Catégorie",
      "Méthode",
      "Type",
      "HT (€)",
      "TVA (€)",
      "TTC (€)",
      "Solde cumulé (€)",
    ],
    rows: rows.map((row) => [
      new Date(row.paidAt).toLocaleString("fr-BE", { timeZone: "Europe/Brussels" }),
      row.pieceNumber ?? "",
      row.reference ?? "",
      row.customerName ?? "",
      row.categoryLabel,
      row.methodLabel + (row.offTill ? " (hors caisse)" : ""),
      TYPE_LABELS[row.transactionType] ?? row.transactionType,
      row.amountHt == null ? "" : (row.isRefund ? -row.amountHt : row.amountHt),
      row.amountVat == null ? "" : (row.isRefund ? -row.amountVat : row.amountVat),
      row.isRefund ? -row.amountTtc : row.amountTtc,
      row.runningTotal,
    ]),
    moneyColumns: [8, 9, 10, 11],
    widths: [20, 12, 22, 26, 16, 18, 14, 14, 14, 14, 16],
  });

  return Buffer.from(await workbook.xlsx.writeBuffer());
}
