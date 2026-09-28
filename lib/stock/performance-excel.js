import { createWorkbook, addReportSheet, exportedAtLabel, toBuffer } from "@/lib/excel/report-workbook";
import { VERDICTS, VERDICT_META } from "@/lib/stock/performance-filters";

/**
 * The Excel export of « Performance par produit » — the list exactly as shown
 * on screen (period + search / verdict filters + sort, applied by the route),
 * same columns as the page's CSV, as real numbers Excel can sort and sum.
 */

const STATUS_LABELS = { DRAFT: "Brouillon", ACTIVE: "Actif", ARCHIVED: "Archivé" };

const dayOnly = (value) => {
  const [year, month, day] = String(value).split("-");
  return `${day}/${month}/${year}`;
};

function lastSale(value) {
  if (!value) return "Jamais";
  return new Date(value).toLocaleDateString("fr-BE", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/Brussels" });
}

/**
 * @param {{ report: object, products: object[], shown: ReturnType<typeof import("@/lib/stock/performance-filters").summarizeProducts>, filterLabel: string }} input
 */
export async function buildProductPerformanceWorkbook({ report, products, shown, filterLabel }) {
  const { filters, sliceLabels } = report;
  const period = filters.mode === "custom" ? "Période choisie" : `${filters.months} derniers mois`;
  const subtitle = `${period} : du ${dayOnly(filters.from)} au ${dayOnly(filters.to)} · ${filterLabel} · Exporté le ${exportedAtLabel()}`;

  const workbook = createWorkbook({
    title: "Performance par produit — Meri Beauty",
    subject: "Ventes, marge et rotation du stock par produit",
  });

  // ── Synthèse ────────────────────────────────────────────────────────────
  const synth = addReportSheet(workbook, { name: "Synthèse", title: "Performance par produit", subtitle, width: 4 });
  synth.sheet.getColumn(1).width = 34;
  synth.sheet.getColumn(2).width = 18;
  synth.section("Indicateurs");
  synth.keyValues([
    { label: "Produits", value: shown.productCount, format: "integer" },
    { label: "Chiffre d'affaires TTC", value: shown.revenueTtc },
    { label: "Marge brute HT", value: shown.marginHt },
    { label: "Unités vendues (nettes)", value: shown.unitsSold, format: "integer" },
    { label: "Valeur du stock (coût HT)", value: shown.stockValueAtCost },
  ]);
  synth.section("Par verdict");
  synth.table({
    autoFilter: false,
    columns: [
      { header: "Verdict", width: 34 },
      { header: "Produits", width: 18, format: "integer" },
      { header: "Valeur du stock (coût HT)", width: 24, format: "money" },
    ],
    rows: VERDICTS.filter((key) => shown.byVerdict[key]).map((key) => [
      VERDICT_META[key].label,
      shown.byVerdict[key].count,
      shown.byVerdict[key].stockValueAtCost,
    ]),
  });

  // ── Produits ────────────────────────────────────────────────────────────
  const list = addReportSheet(workbook, { name: "Produits", title: "Produits", subtitle, width: 25 + sliceLabels.length, tab: "B89664" });
  list.table({
    freeze: true,
    columns: [
      { header: "Produit", width: 36 },
      { header: "Marque", width: 18 },
      { header: "Catégorie", width: 18 },
      { header: "Statut", width: 10 },
      { header: "Verdict", width: 30 },
      { header: "Classe ABC", width: 9 },
      { header: "Vendus", width: 9, format: "integer" },
      { header: "Retours", width: 9, format: "integer" },
      { header: "Vendus nets", width: 11, format: "integer" },
      { header: "Moyenne / mois", width: 12, format: "decimal" },
      { header: "CA TTC (€)", width: 13, format: "money" },
      { header: "Part du CA", width: 10, format: "percent" },
      { header: "CA HT (€)", width: 13, format: "money" },
      { header: "Coût d'achat HT (€)", width: 16, format: "money" },
      { header: "Marge HT (€)", width: 13, format: "money" },
      { header: "Taux de marge", width: 12, format: "percent" },
      { header: "Stock début", width: 10, format: "integer" },
      { header: "Réassort", width: 10, format: "integer" },
      { header: "Soins", width: 9, format: "integer" },
      { header: "Pertes", width: 9, format: "integer" },
      { header: "Stock actuel", width: 11, format: "integer" },
      { header: "Valeur stock (coût HT, €)", width: 18, format: "money" },
      { header: "Mois de stock", width: 12, format: "decimal" },
      { header: "Taux d'écoulement", width: 14, format: "percent" },
      { header: "Dernière vente", width: 14 },
      ...sliceLabels.map((label) => ({ header: `Vendus ${label}`, width: 11, format: "integer" })),
    ],
    rows: products.map((p) => [
      p.name,
      p.brand?.name ?? "",
      p.category?.name ?? "",
      STATUS_LABELS[p.status] ?? p.status,
      VERDICT_META[p.verdict]?.label ?? p.verdict,
      p.abcClass ?? "",
      p.unitsSold,
      p.unitsReturned,
      p.netSold,
      p.avgPerMonth,
      p.revenueTtc,
      p.revenueShare,
      p.revenueHt,
      p.costOfSales,
      p.marginHt,
      p.marginRate ?? "",
      p.stockStart,
      p.restocked,
      p.salonUsage,
      p.losses,
      p.stockNow,
      p.stockValueAtCost,
      p.coverageMonths ?? "",
      p.sellThrough ?? "",
      lastSale(p.lastSaleAt),
      ...p.monthly,
    ]),
  });

  return toBuffer(workbook);
}
