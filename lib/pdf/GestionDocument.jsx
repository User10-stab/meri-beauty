import { Document, Page, View, Text } from "@react-pdf/renderer";
import { COLORS, money } from "./theme";
import { Letterhead, Footer, Kpis, SectionTitle, ReportTable, reportStyles, formatDayOnly, truncate } from "./report-kit";

/**
 * The printable Gestion report (lib/gestion/build-gestion-report.js): the
 * same figures as /dashboard/gestion for the same period and category —
 * synthèse TTC / TVA / HT, then par catégorie, par mois, charges du salon and
 * dépenses de caisse.
 */

const rate = (value) => (value == null ? "—" : `${String(value).replace(".", ",")} %`);
const tint = (value) => (value == null ? undefined : value < 0 ? COLORS.credit : COLORS.brand);

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
  // No « → »: the built-in PDF font has no arrow glyph.
  return expense.endDate ? `Mensuel de ${month(expense.date)} à ${month(expense.endDate)}` : `Mensuel depuis ${month(expense.date)}`;
}

/** @param {{ report: Awaited<ReturnType<typeof import("@/lib/gestion/build-gestion-report").buildGestionReport>> }} props */
export function GestionDocument({ report }) {
  const { filters, summary, categories, months, expenses, cashExpenses, truncated, generatedAt } = report;
  const isWholeSalon = filters.category === "ALL";

  const kpis = [
    { label: "Chiffre d'affaires TTC", value: money(summary.revenueTtc), note: "Encaissé, TVA comprise" },
    { label: "TVA collectée", value: money(summary.revenueVat), note: "À reverser à l'État" },
    { label: "Chiffre d'affaires HT", value: money(summary.revenueHt) },
    { label: "Coût des produits vendus", value: money(summary.costHt) },
    { label: "Marge brute", value: money(summary.grossMarginHt), note: summary.grossMarginRate != null ? `${rate(summary.grossMarginRate)} du CA` : undefined },
    { label: "Charges du salon (HT)", value: money(summary.chargesHt), note: `${money(summary.chargesTtc)} TTC` },
    { label: "Dépenses de caisse", value: money(summary.cashExpenses) },
    isWholeSalon
      ? { label: "Bénéfice net (HT)", value: money(summary.netProfitHt), note: `${rate(summary.netMarginRate)} du CA`, color: tint(summary.netProfitHt) }
      : { label: "Bénéfice net", value: "—", note: "Choisir « Toutes les catégories »" },
  ];

  return (
    <Document title="Gestion — Meri Beauty" author="Meri Beauty" subject="Marge nette du salon sur une période">
      <Page size="A4" orientation="landscape" style={reportStyles.page}>
        <Letterhead
          subtitle="Gestion — marge nette du salon"
          meta={[
            ["Période", `Du ${formatDayOnly(filters.from)} au ${formatDayOnly(filters.to)}`],
            ["Catégorie", filters.categoryLabel],
          ]}
        />
        <Footer generatedAt={generatedAt} />

        {truncated && (
          <View style={reportStyles.notice}>
            <Text>Période trop large — seules les 5 000 premières recettes sont comptées. Réduisez la période pour un résultat exact.</Text>
          </View>
        )}
        {summary.itemsWithoutCost > 0 && (
          <View style={reportStyles.notice}>
            <Text>
              {summary.itemsWithoutCost} article{summary.itemsWithoutCost > 1 ? "s" : ""} vendu{summary.itemsWithoutCost > 1 ? "s" : ""} sans
              prix d&apos;achat renseigné : leur coût est compté à 0 €, la marge est donc surestimée.
            </Text>
            {(summary.productsWithoutCost ?? []).map((p) => (
              <Text key={p.variantId} style={{ marginTop: 2 }}>
                • {p.productName}
                {p.variantName ? ` — ${p.variantName}` : ""} : {p.quantity} vendu{p.quantity > 1 ? "s" : ""}
              </Text>
            ))}
          </View>
        )}

        <Kpis items={kpis} />

        <SectionTitle>Par mois</SectionTitle>
        <ReportTable
          columns={[
            { key: "month", label: "Mois", flex: 1.4 },
            { key: "ttc", label: "CA TTC", align: "right" },
            { key: "vat", label: "TVA", align: "right" },
            { key: "ht", label: "CA HT", align: "right" },
            { key: "cost", label: "Coût produits", align: "right" },
            { key: "gross", label: "Marge brute", align: "right" },
            { key: "charges", label: "Charges HT", align: "right" },
            { key: "cash", label: "Dépenses caisse", align: "right" },
            { key: "net", label: "Bénéfice net", align: "right" },
          ]}
          rows={months.map((m) => ({
            _key: m.month,
            month: monthLabel(m.month),
            ttc: money(m.revenueTtc),
            vat: money(m.revenueVat),
            ht: money(m.revenueHt),
            cost: money(m.costHt),
            gross: money(m.grossMarginHt),
            charges: money(m.chargesHt),
            cash: money(m.cashExpenses),
            net: m.netProfitHt == null ? "—" : money(m.netProfitHt),
            _colors: { net: tint(m.netProfitHt) },
          }))}
          total={
            months.length > 1
              ? {
                  month: "Total",
                  ttc: money(summary.revenueTtc),
                  vat: money(summary.revenueVat),
                  ht: money(summary.revenueHt),
                  cost: money(summary.costHt),
                  gross: money(summary.grossMarginHt),
                  charges: money(summary.chargesHt),
                  cash: money(summary.cashExpenses),
                  net: summary.netProfitHt == null ? "—" : money(summary.netProfitHt),
                }
              : null
          }
        />

        <SectionTitle>Par catégorie</SectionTitle>
        <ReportTable
          emptyLabel="Aucune recette sur cette période."
          columns={[
            { key: "label", label: "Catégorie", flex: 1.8 },
            { key: "count", label: "Écritures", align: "right", flex: 0.7 },
            { key: "ttc", label: "CA TTC", align: "right" },
            { key: "ht", label: "CA HT", align: "right" },
            { key: "cost", label: "Coût produits", align: "right" },
            { key: "margin", label: "Marge brute", align: "right" },
            { key: "rate", label: "Taux", align: "right", flex: 0.7 },
          ]}
          rows={categories.map((c) => ({
            _key: c.category,
            label: c.label,
            count: String(c.count),
            ttc: money(c.revenueTtc),
            ht: money(c.revenueHt),
            cost: c.costHt ? money(c.costHt) : "—",
            margin: money(c.marginHt),
            rate: rate(c.marginRate),
            _colors: { margin: tint(c.marginHt) },
          }))}
          total={{
            label: "Total",
            count: String(categories.reduce((n, c) => n + c.count, 0)),
            ttc: money(summary.revenueTtc),
            ht: money(summary.revenueHt),
            cost: money(summary.costHt),
            margin: money(summary.grossMarginHt),
            rate: rate(summary.grossMarginRate),
          }}
        />

        <SectionTitle>Charges du salon</SectionTitle>
        <ReportTable
          emptyLabel="Aucune charge sur cette période."
          columns={[
            { key: "category", label: "Type", flex: 1.1 },
            { key: "label", label: "Libellé", flex: 1.8 },
            { key: "period", label: "Date / période", flex: 1.6 },
            { key: "ttc", label: "Montant TTC", align: "right" },
            { key: "vat", label: "TVA", align: "right", flex: 0.5 },
            { key: "ht", label: "Sur la période (HT)", align: "right", flex: 1.2 },
          ]}
          rows={expenses.map((e) => ({
            _key: e.id,
            category: e.categoryLabel,
            label: truncate(e.label, 40),
            period: expensePeriod(e),
            ttc: `${money(e.amountTtc)}${e.isRecurring ? " /mois" : ""}`,
            vat: `${e.vatRate} %`,
            ht: money(-e.periodAmountHt),
          }))}
          total={{ category: "Total", ttc: money(summary.chargesTtc), ht: money(-summary.chargesHt) }}
        />

        <SectionTitle>Dépenses de caisse</SectionTitle>
        <ReportTable
          emptyLabel="Aucune dépense de caisse sur cette période."
          columns={[
            { key: "date", label: "Date", flex: 0.9 },
            { key: "piece", label: "Pièce", flex: 0.8 },
            { key: "label", label: "Libellé", flex: 3 },
            { key: "amount", label: "Montant", align: "right" },
          ]}
          rows={cashExpenses.map((c) => ({
            _key: c.id,
            date: shortDate(c.occurredAt),
            piece: c.pieceNumber ?? "",
            label: truncate(c.label, 80),
            amount: money(-c.amount),
          }))}
          total={{ date: "Total", amount: money(-summary.cashExpenses) }}
        />
      </Page>
    </Document>
  );
}
