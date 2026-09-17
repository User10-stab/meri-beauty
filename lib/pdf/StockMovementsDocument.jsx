import fs from "node:fs";
import path from "node:path";
import { Document, Page, View, Text, Image, StyleSheet } from "@react-pdf/renderer";
import { COLORS, formatDate } from "./theme";
import { groupMovementsByDay, formatDayLabel } from "@/lib/stock/movement-day-groups";

/**
 * The printable "mouvements de stock" ledger — every InventoryMovement
 * (including ADJUSTMENT) across the whole catalogue over a date range, the
 * audit trail a stock controller can be handed. Same recipe as
 * RecettesJournalDocument.jsx: landscape A4, fixed logo/letterhead/footer,
 * "Généré le … — Meri Beauty / Page X / Y" pagination.
 */
const LOGO_BUFFER = fs.readFileSync(path.join(process.cwd(), "public", "Images", "Logo.png"));

/** "17 septembre 2026 à 14:32" — the generation time, not just the day. */
function formatDateTime(date) {
  const time = new Date(date).toLocaleTimeString("fr-BE", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Brussels",
  });
  return `${formatDate(date)} à ${time}`;
}

/** "2026-09-01" → "01/09/2026" for printed labels. */
function formatDayOnly(value) {
  const [year, month, day] = String(value).split("-");
  return day && month && year ? `${day}/${month}/${year}` : value;
}

function truncate(value, maxLength) {
  if (!value || value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1)}…`;
}

const styles = StyleSheet.create({
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
  headerBrand: { flexDirection: "row", alignItems: "center", gap: 8 },
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
    color: COLORS.text,
  },
  synthesis: { flexDirection: "row", marginBottom: 12, flexWrap: "wrap" },
  synthesisItem: { flex: 1, minWidth: 90, paddingRight: 10, marginBottom: 6 },
  synthesisLabel: { fontSize: 6.5, letterSpacing: 0.5, color: COLORS.muted, textTransform: "uppercase" },
  synthesisValue: { fontSize: 11, fontWeight: 700, color: COLORS.brand, marginTop: 2 },

  tableHead: {
    flexDirection: "row",
    backgroundColor: COLORS.panel,
    paddingVertical: 4,
    paddingHorizontal: 6,
  },
  tableHeadCell: { fontSize: 6.5, fontWeight: 700, letterSpacing: 0.4, color: COLORS.brand },
  dayRow: {
    flexDirection: "row",
    backgroundColor: COLORS.panel,
    paddingVertical: 4,
    paddingHorizontal: 6,
    marginTop: 4,
  },
  dataRow: {
    flexDirection: "row",
    paddingVertical: 3,
    paddingHorizontal: 6,
    borderBottom: `0.5 solid ${COLORS.hairline}`,
  },
  bold: { fontWeight: 700 },
  colDate: { flex: 1.2, overflow: "hidden" },
  colProduct: { flex: 2, overflow: "hidden" },
  colSku: { flex: 1.1, overflow: "hidden" },
  colType: { flex: 1.3, overflow: "hidden" },
  colQty: { flex: 0.6, textAlign: "right", paddingRight: 6 },
  // Avant / après as three fixed slots (17 Sep 2026: "2 » 1" read as one
  // number) — the two figures sit well apart and align row to row.
  beforeAfter: { flex: 1.3, flexDirection: "row", justifyContent: "flex-end", paddingRight: 14 },
  beforeValue: { width: 34, textAlign: "right" },
  beforeArrow: { width: 36, textAlign: "center", color: COLORS.muted },
  afterValue: { width: 34, textAlign: "left" },
  colReason: { flex: 2.5, overflow: "hidden", paddingLeft: 4 },
  colBy: { flex: 1.3, overflow: "hidden" },
  colDayLabel: { flex: 9.3 },
  colDayCount: { flex: 1.4, textAlign: "right" },

  // ─── Closing block (end of the document) ──────────────────────────────
  closing: { marginTop: 16, alignItems: "flex-end" },
  closingBox: { width: 280, borderTop: `1 solid ${COLORS.brand}`, paddingTop: 6 },
  closingRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2.5 },
  closingLabel: { fontSize: 8, color: COLORS.muted },
  closingValue: { fontSize: 8.5 },
  closingGrand: {
    flexDirection: "row",
    justifyContent: "space-between",
    backgroundColor: COLORS.brand,
    paddingVertical: 6,
    paddingHorizontal: 8,
    marginTop: 4,
  },
  closingGrandLabel: { fontSize: 8, fontWeight: 700, letterSpacing: 0.6, color: COLORS.white },
  closingGrandValue: { fontSize: 10, fontWeight: 700, color: COLORS.white },
  closingNote: { fontSize: 6.5, color: COLORS.muted, marginTop: 5, textAlign: "right" },
  closingGenerated: { fontSize: 7, color: COLORS.muted, marginTop: 6, textAlign: "right" },
});

function Letterhead({ filters }) {
  return (
    <View style={styles.header} fixed>
      <View style={styles.headerBrand}>
        {/* react-pdf's own Image component, not an HTML/next <img> — no alt prop exists on it. */}
        {/* eslint-disable-next-line jsx-a11y/alt-text */}
        <Image src={LOGO_BUFFER} style={styles.logo} />
        <View style={styles.headerBrandText}>
          <Text style={styles.headerTitle}>Meri Beauty</Text>
          <Text style={styles.headerSubtitle}>Mouvements de stock</Text>
        </View>
      </View>
      <View style={styles.headerMeta}>
        <Text style={styles.headerMetaLine}>
          <Text style={styles.headerMetaLabel}>Période : </Text>
          Du {filters.from} au {filters.to}
        </Text>
        <Text style={styles.headerMetaLine}>
          <Text style={styles.headerMetaLabel}>Type : </Text>
          {filters.typeLabel}
        </Text>
      </View>
    </View>
  );
}

function Footer({ generatedAt }) {
  return (
    <View style={styles.footer} fixed>
      <Text style={styles.footerText}>Généré le {formatDateTime(generatedAt)} — Meri Beauty</Text>
      <Text
        style={styles.footerText}
        render={({ pageNumber, totalPages }) => `Page ${pageNumber} / ${totalPages}`}
      />
    </View>
  );
}

function TableHead() {
  return (
    <View style={styles.tableHead} fixed>
      <Text style={[styles.tableHeadCell, styles.colDate]}>DATE</Text>
      <Text style={[styles.tableHeadCell, styles.colProduct]}>PRODUIT</Text>
      <Text style={[styles.tableHeadCell, styles.colSku]}>RÉFÉRENCE</Text>
      <Text style={[styles.tableHeadCell, styles.colType]}>TYPE</Text>
      <Text style={[styles.tableHeadCell, styles.colQty]}>QTÉ</Text>
      <View style={styles.beforeAfter}>
        <Text style={[styles.tableHeadCell, styles.beforeValue]}>AVANT</Text>
        <Text style={[styles.tableHeadCell, styles.beforeArrow]}>»</Text>
        <Text style={[styles.tableHeadCell, styles.afterValue]}>APRÈS</Text>
      </View>
      <Text style={[styles.tableHeadCell, styles.colReason]}>MOTIF</Text>
      <Text style={[styles.tableHeadCell, styles.colBy]}>PAR</Text>
    </View>
  );
}

function DataRow({ row }) {
  return (
    <View style={styles.dataRow} wrap={false}>
      <Text style={styles.colDate}>
        {new Date(row.createdAt).toLocaleString("fr-BE", {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          timeZone: "Europe/Brussels",
        })}
      </Text>
      <Text style={styles.colProduct}>
        {truncate(row.productName, 28)}
        {row.variantName ? ` — ${truncate(row.variantName, 20)}` : ""}
      </Text>
      <Text style={styles.colSku}>{truncate(row.sku, 18)}</Text>
      <Text style={styles.colType}>{row.typeLabel}</Text>
      <Text style={[styles.colQty, row.quantity < 0 && { color: COLORS.credit }]}>
        {row.quantity > 0 ? "+" : ""}
        {row.quantity}
      </Text>
      <View style={styles.beforeAfter}>
        <Text style={styles.beforeValue}>{row.previousStock}</Text>
        <Text style={styles.beforeArrow}>»</Text>
        <Text style={styles.afterValue}>{row.newStock}</Text>
      </View>
      <Text style={styles.colReason}>{truncate(row.reason, 40) || "—"}</Text>
      <Text style={styles.colBy}>{truncate(row.createdByName, 20) || "—"}</Text>
    </View>
  );
}

function DayBlock({ group }) {
  return (
    <View>
      <View style={styles.dayRow} wrap={false}>
        <Text style={[styles.colDayLabel, styles.bold]}>
          {formatDayLabel(group.date)} ({group.rows.length} mouvement{group.rows.length > 1 ? "s" : ""})
        </Text>
      </View>
      {group.rows.map((row) => (
        <DataRow key={row.id} row={row} />
      ))}
    </View>
  );
}

/**
 * Closes the ledger on the catalogue's total stock, so a controller reading a
 * list of movements can check it against a physical count. Always computed
 * over every movement type (see computeStockTotals), even when the list above
 * is filtered to one.
 */
function StockTotals({ filters, stock, generatedAt }) {
  return (
    <View style={styles.closing} wrap={false}>
      <View style={styles.closingBox}>
        <View style={styles.closingRow}>
          <Text style={styles.closingLabel}>Stock total au début ({formatDayOnly(filters.from)})</Text>
          <Text style={styles.closingValue}>{stock.atStart} unités</Text>
        </View>
        <View style={styles.closingRow}>
          <Text style={styles.closingLabel}>Entrées de la période</Text>
          <Text style={styles.closingValue}>+{stock.unitsIn} unités</Text>
        </View>
        <View style={styles.closingRow}>
          <Text style={styles.closingLabel}>Sorties de la période</Text>
          <Text style={styles.closingValue}>-{stock.unitsOut} unités</Text>
        </View>
        <View style={styles.closingGrand}>
          <Text style={styles.closingGrandLabel}>STOCK TOTAL À LA FIN ({formatDayOnly(filters.to)})</Text>
          <Text style={styles.closingGrandValue}>{stock.atEnd} unités</Text>
        </View>
        {filters.type !== "ALL" && (
          <Text style={styles.closingNote}>Totaux calculés sur tous les types de mouvement, pas seulement « {filters.typeLabel} ».</Text>
        )}
        <Text style={styles.closingGenerated}>Document généré le {formatDateTime(generatedAt)}</Text>
      </View>
    </View>
  );
}

/** @param {ReturnType<typeof import("@/lib/stock/build-stock-movements-report").buildStockMovementsReport>} report */
export function StockMovementsDocument({ report }) {
  const { filters, summary, rows, truncated, generatedAt } = report;
  const dayGroups = groupMovementsByDay(rows);
  const nonZeroTypes = summary.byType.filter((t) => t.count > 0);

  return (
    <Document title="Mouvements de stock — Meri Beauty" author="Meri Beauty" subject="Journal des mouvements de stock">
      <Page size="A4" orientation="landscape" style={styles.page}>
        <Letterhead filters={filters} />
        <Footer generatedAt={generatedAt} />

        {truncated && (
          <View style={styles.notice}>
            <Text>
              Période trop large — ce document est limité aux 5 000 premiers mouvements. Affinez les dates
              pour un relevé complet.
            </Text>
          </View>
        )}

        <View style={styles.synthesis}>
          <View style={styles.synthesisItem}>
            <Text style={styles.synthesisLabel}>Stock au début ({formatDayOnly(filters.from)})</Text>
            <Text style={styles.synthesisValue}>{summary.stock.atStart}</Text>
          </View>
          <View style={styles.synthesisItem}>
            <Text style={styles.synthesisLabel}>Stock à la fin ({formatDayOnly(filters.to)})</Text>
            <Text style={styles.synthesisValue}>{summary.stock.atEnd}</Text>
          </View>
          <View style={styles.synthesisItem}>
            <Text style={styles.synthesisLabel}>Total mouvements</Text>
            <Text style={styles.synthesisValue}>{summary.count}</Text>
          </View>
          {nonZeroTypes.map((t) => (
            <View style={styles.synthesisItem} key={t.type}>
              <Text style={styles.synthesisLabel}>{t.label}</Text>
              <Text style={styles.synthesisValue}>{t.count}</Text>
            </View>
          ))}
        </View>

        <TableHead />
        {dayGroups.length === 0 ? (
          <Text style={{ paddingVertical: 20, textAlign: "center", color: COLORS.muted }}>
            Aucun mouvement sur cette période.
          </Text>
        ) : (
          dayGroups.map((group) => <DayBlock key={group.key} group={group} />)
        )}

        <StockTotals filters={filters} stock={summary.stock} generatedAt={generatedAt} />
      </Page>
    </Document>
  );
}
