import ExcelJS from "exceljs";

/**
 * Shared styling for the management-report workbooks (Gestion, Performance
 * par produit) — the same brand look as lib/recettes-excel.js: dark title
 * bar, gold section bars, dark header rows, cream zebra rows, real number
 * formats (so Excel can sum and sort) and frozen headers.
 *
 * The older workbooks (recettes, caisse, reports) keep their own copies on
 * purpose; this one is only for the new reports.
 */
const BRAND = {
  ink: "2F3A2E",
  gold: "B89664",
  cream: "F7F5F0",
  mist: "EEF1EC",
  white: "FFFFFF",
  slate: "58635A",
  credit: "A4362F",
};

export const FORMATS = {
  money: '#,##0.00 [$€-fr-BE]',
  // Values stored as fractions (0.25 → 25 %).
  percent: "0%",
  // Values stored as percentages with one decimal (45.3 → 45,3 %).
  percentPoints: '0.0" %"',
  integer: "0",
  decimal: "0.0",
};

export function createWorkbook({ title, subject }) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Meri Beauty";
  workbook.created = new Date();
  workbook.modified = new Date();
  workbook.properties.title = title;
  workbook.properties.subject = subject;
  return workbook;
}

export function exportedAtLabel() {
  return new Date().toLocaleString("fr-BE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Brussels",
  });
}

function columnLetter(index) {
  let n = index;
  let letters = "";
  while (n > 0) {
    const rest = (n - 1) % 26;
    letters = String.fromCharCode(65 + rest) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

/**
 * A new sheet with the title bar (row 1) and subtitle (row 2). Returns a
 * cursor object: write sections with its methods, rows are tracked for you.
 */
export function addReportSheet(workbook, { name, title, subtitle, width, tab = BRAND.ink }) {
  const sheet = workbook.addWorksheet(name, { properties: { tabColor: { argb: tab } } });
  const last = columnLetter(width);

  sheet.mergeCells(`A1:${last}1`);
  const titleCell = sheet.getCell("A1");
  titleCell.value = title;
  titleCell.font = { name: "Aptos Display", size: 18, bold: true, color: { argb: BRAND.white } };
  titleCell.alignment = { vertical: "middle" };
  titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BRAND.ink } };
  sheet.getRow(1).height = 34;

  sheet.mergeCells(`A2:${last}2`);
  const subtitleCell = sheet.getCell("A2");
  subtitleCell.value = subtitle;
  subtitleCell.font = { name: "Aptos", size: 10, italic: true, color: { argb: BRAND.slate } };
  subtitleCell.alignment = { vertical: "middle", wrapText: true };
  sheet.getRow(2).height = 22;

  let row = 4;

  return {
    sheet,

    /** Gold section bar. */
    section(label) {
      sheet.mergeCells(`A${row}:${last}${row}`);
      const cell = sheet.getCell(`A${row}`);
      cell.value = label.toUpperCase();
      cell.font = { name: "Aptos", size: 11, bold: true, color: { argb: BRAND.white } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BRAND.gold } };
      cell.alignment = { vertical: "middle" };
      sheet.getRow(row).height = 22;
      row += 1;
    },

    /** Label / value pairs. `format` is a FORMATS key (default money). */
    keyValues(pairs) {
      for (const { label, value, format = "money" } of pairs) {
        const r = sheet.getRow(row);
        r.getCell(1).value = label;
        r.getCell(2).value = value;
        for (const cell of [r.getCell(1), r.getCell(2)]) {
          cell.font = { name: "Aptos", size: 11, bold: true, color: { argb: BRAND.ink } };
        }
        r.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: BRAND.mist } };
        r.getCell(2).fill = { type: "pattern", pattern: "solid", fgColor: { argb: BRAND.cream } };
        if (typeof value === "number" && FORMATS[format]) r.getCell(2).numFmt = FORMATS[format];
        row += 1;
      }
      row += 1;
    },

    /**
     * A table. `columns`: [{ header, width?, format? }] (format = FORMATS key);
     * `rows`: arrays of raw values; `total`: optional array for a bold total
     * row. `freeze`: freeze panes under this table's header (use it on a
     * sheet's main table).
     */
    table({ columns, rows, total = null, freeze = false, autoFilter = true }) {
      const headerRowNumber = row;
      const header = sheet.getRow(headerRowNumber);
      columns.forEach((column, index) => {
        const cell = header.getCell(index + 1);
        cell.value = column.header;
        cell.font = { name: "Aptos", size: 10, bold: true, color: { argb: BRAND.white } };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BRAND.ink } };
        cell.alignment = { vertical: "middle", wrapText: true };
        cell.border = { bottom: { style: "medium", color: { argb: BRAND.gold } } };
        if (column.width) {
          const current = sheet.getColumn(index + 1).width ?? 0;
          sheet.getColumn(index + 1).width = Math.max(current, column.width);
        }
      });
      header.height = 28;
      row += 1;

      rows.forEach((values, rowIndex) => {
        const r = sheet.getRow(row);
        values.forEach((value, index) => {
          const cell = r.getCell(index + 1);
          cell.value = value === undefined ? null : value;
          cell.font = { name: "Aptos", size: 10, color: { argb: "263128" } };
          cell.alignment = { vertical: "middle" };
          cell.border = { bottom: { style: "hair", color: { argb: "D7DDD7" } } };
          if (rowIndex % 2 === 1) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BRAND.cream } };
          const format = columns[index]?.format;
          if (format && typeof value === "number") cell.numFmt = FORMATS[format];
        });
        row += 1;
      });

      if (rows.length > 0 && autoFilter) {
        sheet.autoFilter = {
          from: { row: headerRowNumber, column: 1 },
          to: { row: headerRowNumber + rows.length, column: columns.length },
        };
      }

      if (total && rows.length > 0) {
        const r = sheet.getRow(row);
        total.forEach((value, index) => {
          const cell = r.getCell(index + 1);
          cell.value = value === undefined ? null : value;
          cell.font = { name: "Aptos", size: 10, bold: true, color: { argb: BRAND.ink } };
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BRAND.mist } };
          cell.border = { top: { style: "thin", color: { argb: BRAND.ink } } };
          const format = columns[index]?.format;
          if (format && typeof value === "number") cell.numFmt = FORMATS[format];
        });
        row += 1;
      }

      if (freeze) sheet.views = [{ state: "frozen", ySplit: headerRowNumber }];
      row += 1;
    },

    /** Muted one-line note (e.g. a data-quality warning). */
    note(text) {
      sheet.mergeCells(`A${row}:${last}${row}`);
      const cell = sheet.getCell(`A${row}`);
      cell.value = text;
      cell.font = { name: "Aptos", size: 10, italic: true, color: { argb: BRAND.credit } };
      cell.alignment = { wrapText: true, vertical: "middle" };
      sheet.getRow(row).height = 30;
      row += 2;
    },
  };
}

export async function toBuffer(workbook) {
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
