import fs from "node:fs";
import path from "node:path";
import { View, Text, Image, StyleSheet } from "@react-pdf/renderer";
import { COLORS, formatDate } from "./theme";

/**
 * Shared building blocks for the tabular management reports (Gestion,
 * Performance par produit): the same letterhead / footer / KPI strip / table
 * recipe as StockMovementsDocument.jsx and RecettesJournalDocument.jsx —
 * landscape A4, fixed logo header, "Généré le … — Page X / Y" footer — so
 * every printed report from the dashboard looks like one family.
 */
const LOGO_BUFFER = fs.readFileSync(path.join(process.cwd(), "public", "Images", "Logo.png"));

/** "17 septembre 2026 à 14:32". */
export function formatDateTime(date) {
  const time = new Date(date).toLocaleTimeString("fr-BE", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Brussels",
  });
  return `${formatDate(date)} à ${time}`;
}

/** "2026-09-01" → "01/09/2026", with no time-zone round trip. */
export function formatDayOnly(value) {
  const [year, month, day] = String(value).split("-");
  return day && month && year ? `${day}/${month}/${year}` : value;
}

export function truncate(value, maxLength) {
  if (!value || value.length <= maxLength) return value ?? "";
  return `${value.slice(0, maxLength - 1)}…`;
}

export const reportStyles = StyleSheet.create({
  page: {
    paddingTop: 100,
    paddingHorizontal: 28,
    paddingBottom: 40,
    fontSize: 7.5,
    fontFamily: "Helvetica",
    color: COLORS.text,
  },
  header: {
    position: "absolute",
    top: 24,
    left: 28,
    right: 28,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    paddingBottom: 8,
    borderBottom: `0.75 solid ${COLORS.hairline}`,
  },
  headerBrand: { flexDirection: "row", alignItems: "center" },
  logo: { width: 30, height: 25.3 },
  headerBrandText: { marginLeft: 8 },
  headerTitle: { fontSize: 13, fontWeight: 700, color: COLORS.brand },
  headerSubtitle: { fontSize: 8, color: COLORS.muted, marginTop: 1 },
  headerMeta: { alignItems: "flex-end" },
  headerMetaLine: { fontSize: 7.5, color: COLORS.text, marginBottom: 1.5 },
  headerMetaLabel: { color: COLORS.muted },
  footer: {
    position: "absolute",
    bottom: 16,
    left: 28,
    right: 28,
    flexDirection: "row",
    justifyContent: "space-between",
    borderTop: `0.5 solid ${COLORS.hairline}`,
    paddingTop: 5,
  },
  footerText: { fontSize: 7, color: COLORS.faint },
  notice: {
    borderLeft: `2 solid ${COLORS.gold}`,
    backgroundColor: COLORS.panel,
    paddingVertical: 5,
    paddingHorizontal: 8,
    marginBottom: 10,
    fontSize: 7.5,
  },
  kpis: { flexDirection: "row", flexWrap: "wrap", marginBottom: 12 },
  kpi: { width: "25%", paddingRight: 10, marginBottom: 8 },
  kpiLabel: { fontSize: 6.5, letterSpacing: 0.5, color: COLORS.muted, textTransform: "uppercase" },
  kpiValue: { fontSize: 11, fontWeight: 700, color: COLORS.brand, marginTop: 2 },
  kpiNote: { fontSize: 6.5, color: COLORS.muted, marginTop: 1 },
  sectionTitle: {
    fontSize: 9,
    fontWeight: 700,
    color: COLORS.brand,
    marginTop: 12,
    marginBottom: 4,
    paddingBottom: 3,
    borderBottom: `1 solid ${COLORS.gold}`,
  },
  tableHead: { flexDirection: "row", backgroundColor: COLORS.panel, paddingVertical: 4, paddingHorizontal: 6 },
  tableHeadCell: { fontSize: 6.5, fontWeight: 700, letterSpacing: 0.3, color: COLORS.brand },
  row: { flexDirection: "row", paddingVertical: 3, paddingHorizontal: 6, borderBottom: `0.5 solid ${COLORS.hairline}` },
  totalRow: {
    flexDirection: "row",
    paddingVertical: 4,
    paddingHorizontal: 6,
    backgroundColor: COLORS.panel,
    borderTop: `1 solid ${COLORS.brand}`,
  },
  bold: { fontWeight: 700 },
  empty: { paddingVertical: 14, textAlign: "center", color: COLORS.muted },
});

/** Logo + title on the left, label/value meta lines on the right. */
export function Letterhead({ subtitle, meta }) {
  return (
    <View style={reportStyles.header} fixed>
      <View style={reportStyles.headerBrand}>
        {/* react-pdf's own Image component, not an HTML/next <img> — no alt prop exists on it. */}
        {/* eslint-disable-next-line jsx-a11y/alt-text */}
        <Image src={LOGO_BUFFER} style={reportStyles.logo} />
        <View style={reportStyles.headerBrandText}>
          <Text style={reportStyles.headerTitle}>Meri Beauty</Text>
          <Text style={reportStyles.headerSubtitle}>{subtitle}</Text>
        </View>
      </View>
      <View style={reportStyles.headerMeta}>
        {meta.map(([label, value]) => (
          <Text key={label} style={reportStyles.headerMetaLine}>
            <Text style={reportStyles.headerMetaLabel}>{label} : </Text>
            {value}
          </Text>
        ))}
      </View>
    </View>
  );
}

export function Footer({ generatedAt }) {
  return (
    <View style={reportStyles.footer} fixed>
      <Text style={reportStyles.footerText}>Généré le {formatDateTime(generatedAt)} — Meri Beauty</Text>
      <Text style={reportStyles.footerText} render={({ pageNumber, totalPages }) => `Page ${pageNumber} / ${totalPages}`} />
    </View>
  );
}

/** @param {{ items: Array<{ label: string, value: string, note?: string, color?: string }> }} props */
export function Kpis({ items }) {
  return (
    <View style={reportStyles.kpis} wrap={false}>
      {items.map((item) => (
        <View key={item.label} style={reportStyles.kpi}>
          <Text style={reportStyles.kpiLabel}>{item.label}</Text>
          <Text style={[reportStyles.kpiValue, item.color && { color: item.color }]}>{item.value}</Text>
          {item.note ? <Text style={reportStyles.kpiNote}>{item.note}</Text> : null}
        </View>
      ))}
    </View>
  );
}

export function SectionTitle({ children }) {
  return (
    <Text style={reportStyles.sectionTitle} minPresenceAhead={40}>
      {children}
    </Text>
  );
}

/**
 * A plain report table. `columns`: [{ key, label, flex = 1, align = "left" }];
 * each row is an object keyed like the columns (already-formatted strings),
 * optionally with `_colors[key]` per cell.
 *
 * `repeatHeader`: re-print the header row on every following page. Only for a
 * document's LAST (long) table — react-pdf's `fixed` repeats an element on
 * every page after it appears, so a fixed header on an earlier table would
 * print over the tables that follow it.
 */
export function ReportTable({ columns, rows, total = null, repeatHeader = false, emptyLabel = "Rien sur cette période." }) {
  const cell = (column) => ({ flex: column.flex ?? 1, textAlign: column.align ?? "left", paddingRight: 4 });
  return (
    <View>
      <View style={reportStyles.tableHead} fixed={repeatHeader} wrap={false}>
        {columns.map((column) => (
          <Text key={column.key} style={[reportStyles.tableHeadCell, cell(column)]}>
            {column.label.toUpperCase()}
          </Text>
        ))}
      </View>
      {rows.length === 0 ? (
        <Text style={reportStyles.empty}>{emptyLabel}</Text>
      ) : (
        rows.map((row, index) => (
          <View key={row._key ?? index} style={reportStyles.row} wrap={false}>
            {columns.map((column) => (
              <Text key={column.key} style={[cell(column), row._colors?.[column.key] && { color: row._colors[column.key] }]}>
                {row[column.key] ?? ""}
              </Text>
            ))}
          </View>
        ))
      )}
      {total && rows.length > 0 && (
        <View style={reportStyles.totalRow} wrap={false}>
          {columns.map((column) => (
            <Text key={column.key} style={[cell(column), reportStyles.bold]}>
              {total[column.key] ?? ""}
            </Text>
          ))}
        </View>
      )}
    </View>
  );
}
