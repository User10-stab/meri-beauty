import { createWorkbook, addReportSheet, exportedAtLabel, toBuffer } from "@/lib/excel/report-workbook";

/**
 * The Excel export of /dashboard/gestion — the same figures as the page for
 * the same period and category (lib/gestion/build-gestion-report.js), one
 * sheet per table so each keeps its own sort/filter in Excel.
 */

function monthLabel(key) {
  const [year, month] = key.split("-").map(Number);
  const label = new Date(year, month - 1, 1).toLocaleDateString("fr-BE", { month: "long", year: "numeric" });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function shortDate(value) {
  return new Date(value).toLocaleDateString("fr-BE", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/Brussels" });
}

function expensePeriod(expense) {
  if (!expense.isRecurring) return shortDate(expense.date);
  const month = (value) => new Date(value).toLocaleDateString("fr-BE", { month: "2-digit", year: "numeric", timeZone: "Europe/Brussels" });
  return expense.endDate ? `Mensuel ${month(expense.date)} → ${month(expense.endDate)}` : `Mensuel depuis ${month(expense.date)}`;
}

const dayOnly = (value) => {
  const [year, month, day] = String(value).split("-");
  return `${day}/${month}/${year}`;
};

/** @param {Awaited<ReturnType<typeof import("@/lib/gestion/build-gestion-report").buildGestionReport>>} report */
export async function buildGestionWorkbook(report) {
  const { filters, summary, categories, months, expenses, cashExpenses } = report;
  const isWholeSalon = filters.category === "ALL";
  const subtitle = `Du ${dayOnly(filters.from)} au ${dayOnly(filters.to)} · ${filters.categoryLabel} · Exporté le ${exportedAtLabel()}`;

  const workbook = createWorkbook({ title: "Gestion — Meri Beauty", subject: "Marge nette du salon sur une période" });

  // ── Synthèse ────────────────────────────────────────────────────────────
  const synth = addReportSheet(workbook, { name: "Synthèse", title: "Gestion — marge nette", subtitle, width: 4 });
  synth.sheet.getColumn(1).width = 38;
  synth.sheet.getColumn(2).width = 20;
  if (summary.itemsWithoutCost > 0) {
    synth.note(
      `${summary.itemsWithoutCost} article(s) vendu(s) sans prix d'achat renseigné : leur coût est compté à 0 €, la marge est donc surestimée.`
    );
  }
  if (summary.productsWithoutCost?.length) {
    synth.table({
      autoFilter: false,
      columns: [
        { header: "Produit sans prix d'achat", width: 38 },
        { header: "Vendus", width: 20 },
      ],
      rows: summary.productsWithoutCost.map((p) => [
        p.variantName ? `${p.productName} — ${p.variantName}` : p.productName,
        p.quantity,
      ]),
    });
  }
  synth.section("Chiffre d'affaires");
  synth.keyValues([
    { label: "Chiffre d'affaires TTC (encaissé)", value: summary.revenueTtc },
    { label: "TVA collectée", value: summary.revenueVat },
    { label: "Chiffre d'affaires HT", value: summary.revenueHt },
  ]);
  synth.section("Résultat (HT)");
  synth.keyValues([
    { label: "Chiffre d'affaires HT", value: summary.revenueHt },
    { label: "Coût d'achat des produits vendus", value: -summary.costHt },
    { label: "Marge brute", value: summary.grossMarginHt },
    { label: "Taux de marge brute", value: summary.grossMarginRate ?? "—", format: "percentPoints" },
    ...(isWholeSalon
      ? [
          { label: "Charges du salon (HT)", value: -summary.chargesHt },
          { label: "Dépenses de caisse", value: -summary.cashExpenses },
          { label: "Bénéfice net", value: summary.netProfitHt },
          { label: "Marge nette", value: summary.netMarginRate ?? "—", format: "percentPoints" },
        ]
      : [{ label: "Bénéfice net", value: "Choisir « Toutes les catégories »", format: null }]),
  ]);

  // ── Par mois ────────────────────────────────────────────────────────────
  const byMonth = addReportSheet(workbook, { name: "Par mois", title: "Par mois", subtitle, width: 9 });
  byMonth.table({
    freeze: true,
    columns: [
      { header: "Mois", width: 20 },
      { header: "CA TTC (€)", width: 15, format: "money" },
      { header: "TVA (€)", width: 13, format: "money" },
      { header: "CA HT (€)", width: 15, format: "money" },
      { header: "Coût produits (€)", width: 16, format: "money" },
      { header: "Marge brute (€)", width: 16, format: "money" },
      { header: "Charges HT (€)", width: 15, format: "money" },
      { header: "Dépenses caisse (€)", width: 17, format: "money" },
      { header: "Bénéfice net (€)", width: 16, format: "money" },
    ],
    rows: months.map((m) => [
      monthLabel(m.month),
      m.revenueTtc,
      m.revenueVat,
      m.revenueHt,
      m.costHt,
      m.grossMarginHt,
      m.chargesHt,
      m.cashExpenses,
      m.netProfitHt ?? "—",
    ]),
    total: [
      "Total",
      summary.revenueTtc,
      summary.revenueVat,
      summary.revenueHt,
      summary.costHt,
      summary.grossMarginHt,
      summary.chargesHt,
      summary.cashExpenses,
      summary.netProfitHt ?? "—",
    ],
  });

  // ── Par catégorie ───────────────────────────────────────────────────────
  const byCategory = addReportSheet(workbook, { name: "Par catégorie", title: "Par catégorie", subtitle, width: 7, tab: "B89664" });
  byCategory.table({
    freeze: true,
    columns: [
      { header: "Catégorie", width: 26 },
      { header: "Écritures", width: 11, format: "integer" },
      { header: "CA TTC (€)", width: 15, format: "money" },
      { header: "CA HT (€)", width: 15, format: "money" },
      { header: "Coût produits (€)", width: 16, format: "money" },
      { header: "Marge brute (€)", width: 16, format: "money" },
      { header: "Taux de marge", width: 14, format: "percentPoints" },
    ],
    rows: categories.map((c) => [c.label, c.count, c.revenueTtc, c.revenueHt, c.costHt, c.marginHt, c.marginRate ?? "—"]),
    total: [
      "Total",
      categories.reduce((n, c) => n + c.count, 0),
      summary.revenueTtc,
      summary.revenueHt,
      summary.costHt,
      summary.grossMarginHt,
      summary.grossMarginRate ?? "—",
    ],
  });

  // ── Charges du salon ────────────────────────────────────────────────────
  const charges = addReportSheet(workbook, { name: "Charges du salon", title: "Charges du salon", subtitle, width: 7 });
  charges.table({
    freeze: true,
    columns: [
      { header: "Type", width: 18 },
      { header: "Libellé", width: 30 },
      { header: "Date / période", width: 26 },
      { header: "Montant TTC (€)", width: 16, format: "money" },
      { header: "TVA (%)", width: 9, format: "integer" },
      { header: "Sur la période TTC (€)", width: 20, format: "money" },
      { header: "Sur la période HT (€)", width: 20, format: "money" },
    ],
    rows: expenses.map((e) => [e.categoryLabel, e.label, expensePeriod(e), e.amountTtc, e.vatRate, e.periodAmountTtc, e.periodAmountHt]),
    total: ["Total", "", "", "", "", summary.chargesTtc, summary.chargesHt],
  });

  // ── Dépenses de caisse ──────────────────────────────────────────────────
  const cash = addReportSheet(workbook, { name: "Dépenses de caisse", title: "Dépenses de caisse", subtitle, width: 4 });
  cash.table({
    freeze: true,
    columns: [
      { header: "Date", width: 14 },
      { header: "Pièce", width: 12 },
      { header: "Libellé", width: 50 },
      { header: "Montant (€)", width: 15, format: "money" },
    ],
    rows: cashExpenses.map((c) => [shortDate(c.occurredAt), c.pieceNumber ?? "", c.label, c.amount]),
    total: ["Total", "", "", summary.cashExpenses],
  });

  return toBuffer(workbook);
}
