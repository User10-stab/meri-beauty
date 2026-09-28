import { Document, Page, View, Text } from "@react-pdf/renderer";
import { COLORS, money } from "./theme";
import { Letterhead, Footer, Kpis, SectionTitle, ReportTable, reportStyles, formatDayOnly, truncate } from "./report-kit";
import { VERDICTS, VERDICT_META } from "@/lib/stock/performance-filters";

/**
 * The printable « Performance par produit » (lib/stock/build-product-performance.js)
 * — the list exactly as shown on screen: same period, same search / verdict
 * filters and the same sort order (applied by the route before rendering).
 */

const VERDICT_COLORS = {
  STAR: "#047857",
  KEEP: "#0369A1",
  WATCH: "#B45309",
  OVERSTOCK: "#C2410C",
  SALON_ONLY: "#6D28D9",
  REMOVE: COLORS.credit,
  NEW: COLORS.muted,
};

const pct = (value) => (value == null ? "—" : `${Math.round(value * 100)} %`);

function coverage(product) {
  if (product.coverageMonths === null) return product.stockNow > 0 ? "∞" : "—";
  if (product.stockNow <= 0) return "Rupture";
  if (product.coverageMonths < 1) return "< 1 mois";
  return `${String(product.coverageMonths).replace(".", ",")} mois`;
}

function lastSale(value) {
  if (!value) return "Jamais";
  return new Date(value).toLocaleDateString("fr-BE", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/Brussels" });
}

/**
 * @param {{ report: object, products: object[], shown: ReturnType<typeof import("@/lib/stock/performance-filters").summarizeProducts>, filterLabel: string }} props
 */
export function ProductPerformanceDocument({ report, products, shown, filterLabel }) {
  const { filters, generatedAt, history } = report;
  const periodLabel =
    filters.mode === "custom" ? `Du ${formatDayOnly(filters.from)} au ${formatDayOnly(filters.to)}` : `${filters.months} derniers mois`;

  const verdictLine = VERDICTS.filter((key) => shown.byVerdict[key])
    .map((key) => `${VERDICT_META[key].short} : ${shown.byVerdict[key].count}`)
    .join("  ·  ");

  return (
    <Document title="Performance par produit — Meri Beauty" author="Meri Beauty" subject="Ventes, marge et rotation du stock par produit">
      <Page size="A4" orientation="landscape" style={reportStyles.page}>
        <Letterhead
          subtitle="Performance par produit"
          meta={[
            // No « → »: the built-in PDF font has no arrow glyph.
            ["Période", filters.mode === "custom" ? periodLabel : `${periodLabel} (du ${formatDayOnly(filters.from)} au ${formatDayOnly(filters.to)})`],
            ["Affichage", filterLabel],
          ]}
        />
        <Footer generatedAt={generatedAt} />

        {history && (
          <View style={reportStyles.notice}>
            <Text>
              L&apos;historique du catalogue ne commence que le {formatDayOnly(history.since)} : les chiffres portent sur{" "}
              {history.coveredDays} jours, et les verdicts restent indicatifs.
            </Text>
          </View>
        )}

        <Kpis
          items={[
            { label: "Produits", value: String(shown.productCount) },
            { label: "Chiffre d'affaires TTC", value: money(shown.revenueTtc) },
            { label: "Marge brute HT", value: money(shown.marginHt) },
            { label: "Unités vendues (nettes)", value: String(shown.unitsSold) },
            { label: "Valeur du stock (coût HT)", value: money(shown.stockValueAtCost) },
          ]}
        />
        {verdictLine ? <Text style={{ marginBottom: 6, color: COLORS.muted }}>Verdicts — {verdictLine}</Text> : null}

        <SectionTitle>Produits</SectionTitle>
        <ReportTable
          repeatHeader
          emptyLabel="Aucun produit ne correspond à ces filtres."
          columns={[
            { key: "name", label: "Produit", flex: 2.6 },
            { key: "brand", label: "Marque", flex: 1.1 },
            { key: "verdict", label: "Verdict", flex: 1.4 },
            { key: "sold", label: "Vendus nets", align: "right", flex: 0.8 },
            { key: "avg", label: "/ mois", align: "right", flex: 0.6 },
            { key: "revenue", label: "CA TTC", align: "right" },
            { key: "margin", label: "Marge HT", align: "right" },
            { key: "rate", label: "Taux", align: "right", flex: 0.6 },
            { key: "stock", label: "Stock", align: "right", flex: 0.6 },
            { key: "coverage", label: "Couverture", align: "right", flex: 1 },
            { key: "sellThrough", label: "Écoulement", align: "right", flex: 1 },
            { key: "lastSale", label: "Dern. vente", align: "right", flex: 1 },
          ]}
          rows={products.map((p) => ({
            _key: p.id,
            name: truncate(p.name, 48),
            brand: truncate(p.brand?.name ?? "—", 20),
            verdict: VERDICT_META[p.verdict]?.short ?? p.verdict,
            // Not sold, only used in soins: show the soins (never added to the sales total).
            sold: p.netSold <= 0 && p.salonUsage > 0 ? `${p.salonUsage} soins` : String(p.netSold),
            avg: String(p.avgPerMonth).replace(".", ","),
            revenue: money(p.revenueTtc),
            margin: money(p.marginHt),
            rate: pct(p.marginRate),
            stock: String(p.stockNow),
            coverage: coverage(p),
            sellThrough: pct(p.sellThrough),
            lastSale: lastSale(p.lastSaleAt),
            _colors: {
              verdict: VERDICT_COLORS[p.verdict],
              sold: p.netSold <= 0 && p.salonUsage > 0 ? VERDICT_COLORS.SALON_ONLY : undefined,
              margin: p.marginHt < 0 ? COLORS.credit : undefined,
            },
          }))}
          total={{
            name: `Total — ${shown.productCount} produit${shown.productCount > 1 ? "s" : ""}`,
            sold: String(shown.unitsSold),
            revenue: money(shown.revenueTtc),
            margin: money(shown.marginHt),
          }}
        />
      </Page>
    </Document>
  );
}
