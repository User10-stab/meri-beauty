import ExcelJS from "exceljs";

const BRAND = {
  ink: "2F3A2E",
  gold: "B89664",
  cream: "F7F5F0",
  mist: "EEF1EC",
  white: "FFFFFF",
  slate: "58635A",
};

const currencyFormat = '#,##0.00 [$€-fr-BE]';

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

function formatPeriod(months) {
  return { 1: "Ce mois-ci", 2: "2 derniers mois", 3: "3 derniers mois", 6: "6 derniers mois", 12: "12 derniers mois" }[months] ?? `${months} mois`;
}

/** Build the styled workbook used by the private reports download route. */
export async function buildReportsWorkbook(data) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Meri Beauty";
  workbook.created = new Date();
  workbook.modified = new Date();
  workbook.properties.title = "Rapport de gestion — Meri Beauty";
  workbook.properties.subject = "Synthèse du chiffre d'affaires et des encaissements";

  const period = formatPeriod(data.filters.months);
  const scope = data.filters.staffName ? `Praticienne : ${data.filters.staffName}` : "Tout le salon";
  const subtitle = `${period} · ${scope} · Exporté le ${new Date().toLocaleString("fr-BE")}`;

  const summary = workbook.addWorksheet("Synthèse", { properties: { tabColor: { argb: BRAND.ink } } });
  addWorkbookHeader(summary, { title: "Rapport de gestion", subtitle, columns: 6 });
  summary.mergeCells("A4:F4");
  summary.getCell("A4").value = "INDICATEURS CLÉS";
  styleSection(summary.getCell("A4"));
  summary.getRow(4).height = 22;
  const keyMetrics = [
    ["Chiffre d'affaires", data.totalRevenue],
    ["Espèces encaissées", data.cashCollected],
    ["Banque — carte et Stripe", data.bankCollected],
  ];
  keyMetrics.forEach(([label, value], index) => {
    const row = summary.getRow(index + 5);
    row.getCell(1).value = label;
    row.getCell(2).value = value;
    row.getCell(1).font = { name: "Aptos", size: 11, bold: true, color: { argb: BRAND.ink } };
    row.getCell(2).font = { name: "Aptos", size: 11, bold: true, color: { argb: BRAND.ink } };
    row.getCell(2).numFmt = currencyFormat;
    row.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: BRAND.mist } };
    row.getCell(2).fill = { type: "pattern", pattern: "solid", fgColor: { argb: BRAND.cream } };
  });
  summary.mergeCells("A10:F10");
  summary.getCell("A10").value = "ENCAISSEMENTS PAR MOYEN DE PAIEMENT";
  styleSection(summary.getCell("A10"));
  summary.getRow(10).height = 22;
  addTable(summary, {
    startRow: 11,
    headers: ["Moyen de paiement", "Rapprochement", "Net (€)", "Remboursé (€)"],
    rows: data.collectionByMethod.map((row) => [row.label, row.settlement === "cash" ? "Liquide" : "Banque", row.net, row.refunded]),
    moneyColumns: [3, 4],
    widths: [30, 18, 18, 18, 14, 14],
  });
  summary.mergeCells("A17:F17");
  summary.getCell("A17").value = "Lecture : les encaissements sont nets des remboursements et distincts du chiffre d'affaires.";
  summary.getCell("A17").font = { name: "Aptos", size: 9, italic: true, color: { argb: BRAND.slate } };
  summary.getCell("A17").alignment = { wrapText: true, vertical: "middle" };
  summary.getRow(17).height = 30;

  const monthly = workbook.addWorksheet("Chiffre d'affaires", { properties: { tabColor: { argb: BRAND.gold } } });
  addWorkbookHeader(monthly, { title: "Chiffre d'affaires mensuel", subtitle, columns: 6 });
  const monthlyRows = data.revenueByMonth.map((month, index) => [
    month.label,
    month.boutique,
    month.appointments,
    month.workshops,
    month.formations,
    {
      formula: `SUM(B${5 + index}:E${5 + index})`,
      result: month.boutique + month.appointments + month.workshops + month.formations,
    },
  ]);
  addTable(monthly, {
    startRow: 4,
    headers: ["Mois", "Boutique (€)", "Rendez-vous (€)", "Ateliers (€)", "Formations (€)", "Total (€)"],
    rows: monthlyRows,
    moneyColumns: [2, 3, 4, 5, 6],
    widths: [18, 18, 20, 18, 18, 18],
  });
  const totalRowNumber = 5 + monthlyRows.length;
  const totalRow = monthly.getRow(totalRowNumber);
  totalRow.getCell(1).value = "Total période";
  for (let column = 2; column <= 6; column += 1) {
    const letter = String.fromCharCode(64 + column);
    const result = monthlyRows.reduce((sum, row) => sum + Number(row[column - 1]?.result ?? row[column - 1] ?? 0), 0);
    totalRow.getCell(column).value = { formula: `SUM(${letter}5:${letter}${totalRowNumber - 1})`, result };
    totalRow.getCell(column).numFmt = currencyFormat;
  }
  totalRow.eachCell((cell) => {
    cell.font = { name: "Aptos", size: 10, bold: true, color: { argb: BRAND.white } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BRAND.ink } };
  });

  const products = workbook.addWorksheet("Meilleures ventes", { properties: { tabColor: { argb: "0EA5E9" } } });
  addWorkbookHeader(products, { title: "Meilleures ventes", subtitle, columns: 2 });
  addTable(products, {
    startRow: 4,
    headers: ["Produit", "Quantité vendue"],
    rows: data.topProducts.map((product) => [product.name, product.quantity]),
    widths: [46, 20],
  });

  const status = workbook.addWorksheet("Activité", { properties: { tabColor: { argb: "8B5CF6" } } });
  addWorkbookHeader(status, { title: "Activité opérationnelle", subtitle, columns: 4 });
  addTable(status, {
    startRow: 4,
    headers: ["Statut commande", "Nombre", "Statut rendez-vous", "Nombre"],
    rows: Array.from({ length: Math.max(data.orderStatusCounts.length, data.appointmentStatusCounts.length) }, (_, index) => [
      data.orderStatusCounts[index]?.status ?? "",
      data.orderStatusCounts[index]?.count ?? "",
      data.appointmentStatusCounts[index]?.status ?? "",
      data.appointmentStatusCounts[index]?.count ?? "",
    ]),
    widths: [28, 14, 28, 14],
  });

  return Buffer.from(await workbook.xlsx.writeBuffer());
}
