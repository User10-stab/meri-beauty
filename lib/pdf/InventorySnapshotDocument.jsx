import fs from "node:fs";
import path from "node:path";
import { Document, Page, View, Text, Image, StyleSheet } from "@react-pdf/renderer";
import { COLORS, formatDate } from "./theme";

/**
 * The printable "état du stock" — a real generated PDF, not a browser print
 * of the dashboard screen, so it can be handed to a stock controller as
 * standalone, verifiable proof of the current levels. Landscape A4, same
 * recipe as RecettesJournalDocument.jsx (logo, fixed letterhead/footer,
 * page X / Y pagination) so every printed document in the dashboard reads as
 * one family.
 */
const LOGO_BUFFER = fs.readFileSync(path.join(process.cwd(), "public", "Images", "Logo.png"));

// See RecettesJournalDocument.jsx's identical helper for why: react-pdf's
// own text-layout width measurement can misjudge a wrap point on free text
// (a long product name), letting it bleed straight into the next column
// instead of wrapping or being clipped.
/** "17 septembre 2026 à 14:32" — the generation time, not just the day. */
function formatDateTime(date) {
  const time = new Date(date).toLocaleTimeString("fr-BE", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Brussels",
  });
  return `${formatDate(date)} à ${time}`;
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

  synthesis: { flexDirection: "row", marginBottom: 12 },
  synthesisItem: { flex: 1, paddingRight: 10 },
  synthesisLabel: { fontSize: 6.5, letterSpacing: 0.5, color: COLORS.muted, textTransform: "uppercase" },
  synthesisValue: { fontSize: 11, fontWeight: 700, color: COLORS.brand, marginTop: 2 },

  tableHead: {
    flexDirection: "row",
    backgroundColor: COLORS.panel,
    paddingVertical: 4,
    paddingHorizontal: 6,
  },
  tableHeadCell: { fontSize: 6.5, fontWeight: 700, letterSpacing: 0.4, color: COLORS.brand },
  dataRow: {
    flexDirection: "row",
    paddingVertical: 3,
    paddingHorizontal: 6,
    borderBottom: `0.5 solid ${COLORS.hairline}`,
  },
  dataRowLow: { backgroundColor: COLORS.creditPanel },
  colProduct: { flex: 2.6, overflow: "hidden" },
  colVariant: { flex: 1.8, overflow: "hidden" },
  colSku: { flex: 1.6, overflow: "hidden" },
  colStock: { flex: 0.9, textAlign: "right" },
  colReserved: { flex: 0.9, textAlign: "right" },
  colAvailable: { flex: 0.9, textAlign: "right" },
  colThreshold: { flex: 1, textAlign: "right" },

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

function Letterhead({ isHistorical, asOf }) {
  return (
    <View style={styles.header} fixed>
      <View style={styles.headerBrand}>
        {/* react-pdf's own Image component, not an HTML/next <img> — no alt prop exists on it. */}
        {/* eslint-disable-next-line jsx-a11y/alt-text */}
        <Image src={LOGO_BUFFER} style={styles.logo} />
        <View style={styles.headerBrandText}>
          <Text style={styles.headerTitle}>Meri Beauty</Text>
          <Text style={styles.headerSubtitle}>
            {isHistorical ? `État du stock au ${formatDate(asOf)}` : "État du stock"}
          </Text>
        </View>
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

function TableHead({ isHistorical }) {
  return (
    <View style={styles.tableHead} fixed>
      <Text style={[styles.tableHeadCell, styles.colProduct]}>PRODUIT</Text>
      <Text style={[styles.tableHeadCell, styles.colVariant]}>DÉCLINAISON</Text>
      <Text style={[styles.tableHeadCell, styles.colSku]}>RÉFÉRENCE</Text>
      <Text style={[styles.tableHeadCell, styles.colStock]}>{isHistorical ? "STOCK (ce jour)" : "STOCK"}</Text>
      <Text style={[styles.tableHeadCell, styles.colReserved]}>RÉSERVÉ</Text>
      <Text style={[styles.tableHeadCell, styles.colAvailable]}>DISPO.</Text>
      <Text style={[styles.tableHeadCell, styles.colThreshold]}>SEUIL BAS</Text>
    </View>
  );
}

// A historical reconstruction has no record of reservations (never logged as
// InventoryMovement rows — see build-inventory-snapshot.js), so those two
// columns come back null for a past date and print as "—" rather than a
// misleading 0; the low-stock colour then applies to STOCK itself since
// there is no DISPO. figure to carry it.
function DataRow({ row }) {
  const highlightCol = row.availableQuantity == null ? styles.colStock : styles.colAvailable;
  return (
    <View style={[styles.dataRow, row.isLowStock && styles.dataRowLow]} wrap={false}>
      <Text style={styles.colProduct}>{truncate(row.productName, 40)}</Text>
      <Text style={styles.colVariant}>{truncate(row.variantName, 28)}</Text>
      <Text style={styles.colSku}>{truncate(row.sku, 22)}</Text>
      <Text style={[styles.colStock, row.isLowStock && highlightCol === styles.colStock && { color: COLORS.credit, fontWeight: 700 }]}>
        {row.stockQuantity}
      </Text>
      <Text style={styles.colReserved}>{row.reservedQuantity ?? "—"}</Text>
      <Text style={[styles.colAvailable, row.isLowStock && highlightCol === styles.colAvailable && { color: COLORS.credit, fontWeight: 700 }]}>
        {row.availableQuantity ?? "—"}
      </Text>
      <Text style={styles.colThreshold}>{row.lowStockThreshold}</Text>
    </View>
  );
}

/** @param {ReturnType<typeof import("@/lib/stock/build-inventory-snapshot").buildInventorySnapshot>} snapshot */
export function InventorySnapshotDocument({ snapshot }) {
  const { rows, summary, generatedAt, isHistorical, asOf } = snapshot;
  const title = isHistorical ? `État du stock au ${formatDate(asOf)} — Meri Beauty` : "État du stock — Meri Beauty";

  return (
    <Document title={title} author="Meri Beauty" subject={isHistorical ? "Inventaire reconstitué" : "Inventaire courant"}>
      <Page size="A4" orientation="landscape" style={styles.page}>
        <Letterhead isHistorical={isHistorical} asOf={asOf} />
        <Footer generatedAt={generatedAt} />

        {isHistorical && (
          <View style={{ marginBottom: 10, paddingVertical: 6, paddingHorizontal: 10, backgroundColor: COLORS.panel }}>
            <Text style={{ fontSize: 7, color: COLORS.muted }}>
              Quantités reconstituées à partir de l'historique des mouvements de stock. Le réservé et le disponible ne
              sont pas conservés dans le temps et ne peuvent pas être reconstitués pour une date passée.
            </Text>
          </View>
        )}

        <View style={styles.synthesis}>
          <View style={styles.synthesisItem}>
            <Text style={styles.synthesisLabel}>Déclinaisons</Text>
            <Text style={styles.synthesisValue}>{summary.totalVariants}</Text>
          </View>
          <View style={styles.synthesisItem}>
            <Text style={styles.synthesisLabel}>En stock bas</Text>
            <Text style={styles.synthesisValue}>{summary.lowStockCount}</Text>
          </View>
          <View style={styles.synthesisItem}>
            <Text style={styles.synthesisLabel}>Unités en stock</Text>
            <Text style={styles.synthesisValue}>{summary.totalUnits}</Text>
          </View>
        </View>

        <TableHead isHistorical={isHistorical} />
        {rows.length === 0 ? (
          <Text style={{ paddingVertical: 20, textAlign: "center", color: COLORS.muted }}>
            Aucune déclinaison.
          </Text>
        ) : (
          rows.map((row) => <DataRow key={row.id} row={row} />)
        )}

        <View style={styles.closing} wrap={false}>
          <View style={styles.closingBox}>
            <View style={styles.closingRow}>
              <Text style={styles.closingLabel}>Déclinaisons</Text>
              <Text style={styles.closingValue}>{summary.totalVariants}</Text>
            </View>
            <View style={styles.closingRow}>
              <Text style={styles.closingLabel}>En stock bas</Text>
              <Text style={styles.closingValue}>{summary.lowStockCount}</Text>
            </View>
            <View style={styles.closingGrand}>
              <Text style={styles.closingGrandLabel}>
                {isHistorical ? `STOCK TOTAL AU ${formatDate(asOf).toUpperCase()}` : "STOCK TOTAL"}
              </Text>
              <Text style={styles.closingGrandValue}>{summary.totalUnits} unités</Text>
            </View>
            <Text style={styles.closingGenerated}>Document généré le {formatDateTime(generatedAt)}</Text>
          </View>
        </View>
      </Page>
    </Document>
  );
}
