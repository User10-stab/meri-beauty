import { describe, expect, test } from "vitest";
import ExcelJS from "exceljs";
import { buildReportsWorkbook } from "@/lib/reports-excel";

const data = {
  filters: { months: 2, staffId: null, staffName: null },
  totalRevenue: 655,
  cashCollected: 210,
  bankCollected: 445,
  collectionByMethod: [
    { label: "Espèces", settlement: "cash", net: 210, refunded: 0 },
    { label: "Carte (terminal)", settlement: "bank", net: 180, refunded: 20 },
    { label: "En ligne (Stripe)", settlement: "bank", net: 265, refunded: 0 },
  ],
  revenueByMonth: [
    { label: "juil. 26", boutique: 100, appointments: 50, workshops: 25, formations: 0 },
    { label: "août 26", boutique: 300, appointments: 150, workshops: 0, formations: 30 },
  ],
  topProducts: [{ name: "Sérum éclat", quantity: 7 }],
  orderStatusCounts: [{ status: "COMPLETED", count: 8 }],
  appointmentStatusCounts: [{ status: "CONFIRMED", count: 4 }],
};

describe("professional reports Excel workbook", () => {
  test("exports the branded report sheets and values", async () => {
    const output = await buildReportsWorkbook(data);
    expect(output.length).toBeGreaterThan(1000);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(output);

    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      "Synthèse",
      "Chiffre d'affaires",
      "Meilleures ventes",
      "Activité",
    ]);
    expect(workbook.getWorksheet("Synthèse").getCell("A1").value).toBe("Rapport de gestion");
    expect(workbook.getWorksheet("Synthèse").getCell("B5").value).toBe(655);
    expect(workbook.getWorksheet("Chiffre d'affaires").getCell("F5").value).toMatchObject({
      formula: "SUM(B5:E5)",
      result: 175,
    });
  });
});
