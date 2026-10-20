import ExcelJS from "exceljs";
import { invoicePeriodLabel } from "@/lib/invoices/build-invoices-export";

// Same palette as lib/recettes-excel.js.
const INK = "2F3A2E";
const GOLD = "B89664";
const CREAM = "F7F5F0";
const currencyFormat = "#,##0.00 [$€-fr-BE]";
const fill = (argb) => ({ type: "pattern", pattern: "solid", fgColor: { argb } });

/** Styled workbook served by the private Factures download route. */
export async function buildInvoicesWorkbook({ filters, summary, rows }) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Meri Beauty";
  workbook.created = new Date();
  workbook.properties.title = "Factures — Meri Beauty";

  const sheet = workbook.addWorksheet("Factures", { properties: { tabColor: { argb: INK } } });
  const headers = ["N°", "Date", "Client", "N° TVA client", "Origine", "HT (€)", "TVA (€)", "TTC (€)", "Crédité (€)", "Net (€)", "Paiement", "Envoi"];
  const last = String.fromCharCode(64 + headers.length);

  sheet.mergeCells(`A1:${last}1`);
  Object.assign(sheet.getCell("A1"), { value: "Factures" });
  sheet.getCell("A1").font = { name: "Aptos Display", size: 18, bold: true, color: { argb: "FFFFFF" } };
  sheet.getCell("A1").fill = fill(INK);
  sheet.getCell("A1").alignment = { vertical: "middle" };
  sheet.getRow(1).height = 34;

  sheet.mergeCells(`A2:${last}2`);
  sheet.getCell("A2").value = `${invoicePeriodLabel(filters)} · ${filters.sourceLabel} · ${filters.paymentLabel} · ${filters.deliveryLabel} · Exporté le ${new Date().toLocaleString("fr-BE", { timeZone: "Europe/Brussels" })}`;
  sheet.getCell("A2").font = { name: "Aptos", size: 10, italic: true, color: { argb: "58635A" } };
  sheet.getRow(2).height = 22;

  const header = sheet.getRow(4);
  headers.forEach((value, i) => {
    const cell = header.getCell(i + 1);
    cell.value = value;
    cell.font = { name: "Aptos", size: 10, bold: true, color: { argb: "FFFFFF" } };
    cell.fill = fill(INK);
    cell.border = { bottom: { style: "medium", color: { argb: GOLD } } };
    cell.alignment = { vertical: "middle" };
  });
  header.height = 28;

  rows.forEach((r, i) => {
    const row = sheet.getRow(5 + i);
    [r.number, new Date(r.issuedAt).toLocaleDateString("fr-BE", { timeZone: "Europe/Brussels" }), r.customerName, r.customerVatNumber ?? "", r.sourceLabel, r.amountHt, r.amountVat, r.amountTtc, r.credited, r.net, r.paymentLabel, r.sentLabel].forEach((v, c) => {
      const cell = row.getCell(c + 1);
      cell.value = v;
      cell.font = { name: "Aptos", size: 10, color: { argb: "263128" } };
      cell.border = { bottom: { style: "hair", color: { argb: "D7DDD7" } } };
      if (i % 2 === 1) cell.fill = fill(CREAM);
      if (c >= 5 && c <= 9) cell.numFmt = currencyFormat;
    });
  });

  const totalRow = sheet.getRow(5 + rows.length);
  totalRow.getCell(1).value = "Total";
  [summary.totalHt, summary.totalVat, summary.totalTtc, summary.credited, summary.net].forEach((v, i) => {
    totalRow.getCell(6 + i).value = v;
    totalRow.getCell(6 + i).numFmt = currencyFormat;
  });
  totalRow.eachCell({ includeEmpty: true }, (cell) => {
    cell.font = { name: "Aptos", size: 10, bold: true, color: { argb: INK } };
    cell.border = { top: { style: "medium", color: { argb: GOLD } } };
  });

  sheet.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4 + rows.length, column: headers.length } };
  sheet.views = [{ state: "frozen", ySplit: 4 }];
  [20, 12, 28, 18, 16, 14, 14, 14, 14, 14, 14, 16].forEach((w, i) => {
    sheet.getColumn(i + 1).width = w;
  });

  return Buffer.from(await workbook.xlsx.writeBuffer());
}
