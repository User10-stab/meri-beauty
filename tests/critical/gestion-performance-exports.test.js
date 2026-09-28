import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";
import { renderToBuffer } from "@react-pdf/renderer";
import { buildGestionWorkbook } from "@/lib/gestion/gestion-excel";
import { buildProductPerformanceWorkbook } from "@/lib/stock/performance-excel";
import { applyExportView } from "@/lib/stock/performance-filters";
import { GestionDocument } from "@/lib/pdf/GestionDocument";
import { ProductPerformanceDocument } from "@/lib/pdf/ProductPerformanceDocument";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8").replace(/\r\n/g, "\n");

afterEach(() => vi.unstubAllGlobals());

async function readWorkbook(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  return workbook;
}

function findRow(sheet, firstCell) {
  let found = null;
  sheet.eachRow((row) => {
    if (!found && row.getCell(1).value === firstCell) found = row;
  });
  return found;
}

const gestionReport = {
  filters: { from: "2026-09-01", to: "2026-09-28", category: "ALL", categoryLabel: "Toutes les catégories" },
  generatedAt: new Date("2026-09-28T12:00:00Z"),
  truncated: false,
  summary: {
    revenueHt: 9744.44,
    revenueTtc: 10740.73,
    revenueVat: 996.29,
    costHt: 1071.17,
    grossMarginHt: 8673.27,
    grossMarginRate: 89,
    chargesHt: 1700,
    chargesTtc: 1700,
    cashExpenses: 1,
    netProfitHt: 6972.27,
    netMarginRate: 71.6,
    itemsWithoutCost: 2,
    productsWithoutCost: [{ variantId: "v1", productId: "p1", productName: "SOLDE MABON", variantName: null, quantity: 2, orderNumbers: [51, 52] }],
    chargesByCategory: [],
  },
  categories: [{ category: "ORDER", label: "Boutique", count: 3, revenueHt: 9744.44, revenueTtc: 10740.73, costHt: 1071.17, marginHt: 8673.27, marginRate: 89 }],
  months: [
    { month: "2026-09", revenueHt: 9744.44, revenueTtc: 10740.73, revenueVat: 996.29, costHt: 1071.17, grossMarginHt: 8673.27, chargesHt: 1700, cashExpenses: 1, netProfitHt: 6972.27 },
  ],
  expenses: [
    { id: "e1", category: "RENT", categoryLabel: "Loyer du salon", label: "Loyer du salon", amountTtc: 1700, vatRate: 0, date: new Date(2026, 8, 1), isRecurring: true, endDate: null, periodAmountTtc: 1700, periodAmountHt: 1700 },
  ],
  cashExpenses: [{ id: "m1", pieceNumber: "D0001", label: "Sacs", occurredAt: new Date(2026, 8, 5), amount: 1 }],
};

function product(overrides) {
  return {
    id: "p",
    name: "Produit",
    status: "ACTIVE",
    brand: { id: "b", name: "Marque" },
    category: { id: "c", name: "Ongles" },
    verdict: "KEEP",
    abcClass: "B",
    unitsSold: 4,
    unitsReturned: 0,
    netSold: 4,
    avgPerMonth: 0.7,
    revenueTtc: 80,
    revenueShare: 0.2,
    revenueHt: 66.12,
    costOfSales: 20,
    marginHt: 46.12,
    marginRate: 0.7,
    stockStart: 10,
    restocked: 0,
    salonUsage: 0,
    losses: 0,
    stockNow: 6,
    stockValueAtCost: 30,
    coverageMonths: 8.6,
    sellThrough: 0.4,
    lastSaleAt: new Date("2026-09-20"),
    monthly: [1, 1, 0, 1, 0, 1],
    variants: [],
    ...overrides,
  };
}

const performanceReport = {
  generatedAt: new Date("2026-09-28T12:00:00Z"),
  filters: { mode: "preset", months: 6, days: 183, from: "2026-03-29", to: "2026-09-28" },
  history: { since: "2026-08-13", coveredDays: 46 },
  newThresholdDays: 23,
  sliceLabels: ["avr.", "mai", "juin", "juil.", "août", "sept."],
  products: [
    product({ id: "a", name: "Builder Gel Sunny", verdict: "STAR", revenueTtc: 300 }),
    product({ id: "b", name: "Lime à ongles", verdict: "REMOVE", netSold: 0, unitsSold: 0, revenueTtc: 0, marginHt: 0 }),
    product({ id: "c", name: "Builder Gel Magenta", verdict: "KEEP", revenueTtc: 120 }),
  ],
};

describe("Gestion exports", () => {
  it("the Excel workbook carries TTC, TVA and HT per month and lists products missing a purchase price", async () => {
    const workbook = await readWorkbook(await buildGestionWorkbook(gestionReport));
    expect(workbook.worksheets.map((s) => s.name)).toEqual(["Synthèse", "Par mois", "Par catégorie", "Charges du salon", "Dépenses de caisse"]);

    const september = findRow(workbook.getWorksheet("Par mois"), "Septembre 2026");
    expect([2, 3, 4].map((c) => september.getCell(c).value)).toEqual([10740.73, 996.29, 9744.44]);

    const synth = workbook.getWorksheet("Synthèse");
    expect(findRow(synth, "SOLDE MABON").getCell(2).value).toBe(2);
    expect(findRow(synth, "TVA collectée").getCell(2).value).toBe(996.29);
    // A monthly rent on the period counts in full (no prorata).
    expect(findRow(workbook.getWorksheet("Charges du salon"), "Loyer du salon").getCell(7).value).toBe(1700);
  });

  it("the PDF renders", async () => {
    vi.stubGlobal("React", React);
    const pdf = await renderToBuffer(React.createElement(GestionDocument, { report: gestionReport }));
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
  });

  it("buttons and protected routes: Excel download, CSV, PDF in a new tab", () => {
    const client = source("components/dashboard/gestion/GestionClient.jsx");
    expect(client).toContain("/api/gestion/export?");
    expect(client).toContain("/api/gestion/pdf?");
    expect(client).toContain("downloadGestionCsv(data)");
    for (const path of ["app/api/gestion/export/route.js", "app/api/gestion/pdf/route.js"]) {
      const route = source(path);
      expect(route, path).toContain("getGestionReport("); // OWNER/ADMIN check + window normalization
      expect(route, path).toContain('"Cache-Control": "private, no-store"');
      expect(route, path).toContain('export const runtime = "nodejs"');
    }
  });
});

describe("Performance par produit exports", () => {
  it("applies the screen's search / verdict / sort view", () => {
    const params = new URLSearchParams({ q: "builder", tri: "revenue", ordre: "asc" });
    const view = applyExportView(performanceReport, params);
    expect(view.products.map((p) => p.id)).toEqual(["c", "a"]);
    expect(view.shown).toMatchObject({ productCount: 2, revenueTtc: 420 });
    expect(view.filterLabel).toContain("Recherche « builder »");

    const onlyRemove = applyExportView(performanceReport, new URLSearchParams({ verdict: "REMOVE" }));
    expect(onlyRemove.products.map((p) => p.id)).toEqual(["b"]);

    // No view params: every product, best revenue first — the page's default.
    expect(applyExportView(performanceReport, new URLSearchParams()).products.map((p) => p.id)).toEqual(["a", "c", "b"]);
  });

  it("« Vendus » sorts by sales, soins only break ties — and are never added to the sales total", () => {
    const report = {
      ...performanceReport,
      products: [
        product({ id: "sold1", netSold: 1, salonUsage: 0 }),
        product({ id: "soins2", netSold: 0, salonUsage: 2, verdict: "SALON_ONLY" }),
        product({ id: "soins9", netSold: 0, salonUsage: 9, verdict: "SALON_ONLY" }),
      ],
    };
    const view = applyExportView(report, new URLSearchParams({ tri: "sold", ordre: "desc" }));
    // One real sale outranks any number of soins; among the zeros, most soins first.
    expect(view.products.map((p) => p.id)).toEqual(["sold1", "soins9", "soins2"]);
    expect(view.shown.unitsSold).toBe(1);
    expect(view.shown.salonUsage).toBe(11);
  });

  it("the Excel workbook has the product list as real numbers", async () => {
    const view = applyExportView(performanceReport, new URLSearchParams());
    const workbook = await readWorkbook(await buildProductPerformanceWorkbook({ report: performanceReport, ...view }));
    expect(workbook.worksheets.map((s) => s.name)).toEqual(["Synthèse", "Produits"]);
    const row = findRow(workbook.getWorksheet("Produits"), "Builder Gel Sunny");
    expect(row.getCell(11).value).toBe(300); // CA TTC
    expect(row.getCell(5).value).toBe("Meilleures ventes — à conserver");
  });

  it("the PDF renders", async () => {
    vi.stubGlobal("React", React);
    const view = applyExportView(performanceReport, new URLSearchParams());
    const pdf = await renderToBuffer(React.createElement(ProductPerformanceDocument, { report: performanceReport, ...view }));
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
  });

  it("buttons pass the period and the view; routes go through the permission-checked action", () => {
    const client = source("components/dashboard/boutique/ProductPerformanceClient.jsx");
    expect(client).toContain("/api/stock/performance-export?${exportQuery}");
    expect(client).toContain("/api/stock/performance-pdf?${exportQuery}");
    expect(client).toContain("writeViewFilters(new URLSearchParams(), view)");
    for (const path of ["app/api/stock/performance-export/route.js", "app/api/stock/performance-pdf/route.js"]) {
      const route = source(path);
      expect(route, path).toContain("getProductPerformanceReport(");
      expect(route, path).toContain("applyExportView(result.data, searchParams)");
    }
  });
});
