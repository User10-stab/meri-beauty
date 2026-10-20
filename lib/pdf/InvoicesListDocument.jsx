import fs from "node:fs";
import path from "node:path";
import { Document, Page, View, Text, Image, StyleSheet } from "@react-pdf/renderer";
import { COLORS, money, formatDate } from "./theme";
import { invoicePeriodLabel } from "@/lib/invoices/build-invoices-export";

/**
 * The printable Factures list — same letterhead (logo), fixed table header
 * and "Page n / N" footer as the Livre de recettes PDF (RecettesJournalDocument),
 * landscape A4. See that file for why the logo is a PNG read off disk.
 */
const LOGO_BUFFER = fs.readFileSync(path.join(process.cwd(), "public", "Images", "Logo.png"));

function formatDateTime(date) {
  const time = new Date(date).toLocaleTimeString("fr-BE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Brussels" });
  return `${formatDate(date)} à ${time}`;
}

const shortDate = (date) => new Date(date).toLocaleDateString("fr-BE", { timeZone: "Europe/Brussels" });

// Free text of unknown length: cap the source string rather than trust the
// renderer's wrapping (see RecettesJournalDocument's `truncate`).
function truncate(value, maxLength) {
  if (!value || value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1)}…`;
}

const styles = StyleSheet.create({
  page: { paddingTop: 100, paddingHorizontal: 28, paddingBottom: 40, fontSize: 7.5, fontFamily: "Helvetica", color: COLORS.text },
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
  notice: { borderLeft: `2 solid ${COLORS.gold}`, backgroundColor: COLORS.panel, paddingVertical: 5, paddingHorizontal: 8, marginBottom: 10, fontSize: 7.5 },
  synthesis: { flexDirection: "row", marginBottom: 12 },
  synthesisItem: { flex: 1, paddingRight: 10 },
  synthesisLabel: { fontSize: 6.5, letterSpacing: 0.5, color: COLORS.muted, textTransform: "uppercase" },
  synthesisValue: { fontSize: 11, fontWeight: 700, color: COLORS.brand, marginTop: 2 },
  tableHead: { flexDirection: "row", backgroundColor: COLORS.panel, paddingVertical: 4, paddingHorizontal: 6 },
  tableHeadCell: { fontSize: 6.5, fontWeight: 700, letterSpacing: 0.4, color: COLORS.brand },
  dataRow: { flexDirection: "row", paddingVertical: 3, paddingHorizontal: 6, borderBottom: `0.5 solid ${COLORS.hairline}` },
  colNumber: { flex: 1.3, overflow: "hidden" },
  colDate: { flex: 0.9, overflow: "hidden" },
  colClient: { flex: 2.2, overflow: "hidden" },
  colSource: { flex: 1.1, overflow: "hidden" },
  colHt: { flex: 1, textAlign: "right" },
  colVat: { flex: 1, textAlign: "right" },
  colTtc: { flex: 1.1, textAlign: "right" },
  colCredit: { flex: 1, textAlign: "right" },
  colPayment: { flex: 1, paddingLeft: 8, overflow: "hidden" },
  closing: { marginTop: 16, alignItems: "flex-end" },
  closingBox: { width: 260, borderTop: `1 solid ${COLORS.brand}`, paddingTop: 6 },
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
  closingGenerated: { fontSize: 7, color: COLORS.muted, marginTop: 6, textAlign: "right" },
});

function Letterhead({ filters }) {
  return (
    <View style={styles.header} fixed>
      <View style={styles.headerBrand}>
        {/* eslint-disable-next-line jsx-a11y/alt-text */}
        <Image src={LOGO_BUFFER} style={styles.logo} />
        <View style={styles.headerBrandText}>
          <Text style={styles.headerTitle}>Meri Beauty</Text>
          <Text style={styles.headerSubtitle}>Factures</Text>
        </View>
      </View>
      <View style={styles.headerMeta}>
        <Text style={styles.headerMetaLine}>
          <Text style={styles.headerMetaLabel}>Période : </Text>
          {invoicePeriodLabel(filters)}
        </Text>
        <Text style={styles.headerMetaLine}>
          <Text style={styles.headerMetaLabel}>Origine : </Text>
          {filters.sourceLabel}
        </Text>
        <Text style={styles.headerMetaLine}>
          <Text style={styles.headerMetaLabel}>Paiement : </Text>
          {filters.paymentLabel}
        </Text>
      </View>
    </View>
  );
}

function Footer({ generatedAt }) {
  return (
    <View style={styles.footer} fixed>
      <Text style={styles.footerText}>Généré le {formatDateTime(generatedAt)} — Meri Beauty</Text>
      <Text style={styles.footerText} render={({ pageNumber, totalPages }) => `Page ${pageNumber} / ${totalPages}`} />
    </View>
  );
}

function TableHead() {
  return (
    <View style={styles.tableHead} fixed>
      <Text style={[styles.tableHeadCell, styles.colNumber]}>N°</Text>
      <Text style={[styles.tableHeadCell, styles.colDate]}>DATE</Text>
      <Text style={[styles.tableHeadCell, styles.colClient]}>CLIENT</Text>
      <Text style={[styles.tableHeadCell, styles.colSource]}>ORIGINE</Text>
      <Text style={[styles.tableHeadCell, styles.colHt]}>HT</Text>
      <Text style={[styles.tableHeadCell, styles.colVat]}>TVA</Text>
      <Text style={[styles.tableHeadCell, styles.colTtc]}>TTC</Text>
      <Text style={[styles.tableHeadCell, styles.colCredit]}>CRÉDITÉ</Text>
      <Text style={[styles.tableHeadCell, styles.colPayment]}>PAIEMENT</Text>
    </View>
  );
}

function DataRow({ row }) {
  return (
    <View style={styles.dataRow} wrap={false}>
      <Text style={styles.colNumber}>{row.number}</Text>
      <Text style={styles.colDate}>{shortDate(row.issuedAt)}</Text>
      <Text style={styles.colClient}>{truncate(row.customerName, 38) ?? "—"}</Text>
      <Text style={styles.colSource}>{row.sourceLabel}</Text>
      <Text style={styles.colHt}>{money(row.amountHt)}</Text>
      <Text style={styles.colVat}>{money(row.amountVat)}</Text>
      <Text style={styles.colTtc}>{money(row.amountTtc)}</Text>
      <Text style={[styles.colCredit, row.credited > 0 && { color: COLORS.credit }]}>{row.credited > 0 ? money(-row.credited) : "—"}</Text>
      <Text style={styles.colPayment}>{row.paymentLabel}</Text>
    </View>
  );
}

function ClosingTotals({ summary, generatedAt }) {
  return (
    <View style={styles.closing} wrap={false}>
      <View style={styles.closingBox}>
        <View style={styles.closingRow}>
          <Text style={styles.closingLabel}>Total hors TVA</Text>
          <Text style={styles.closingValue}>{money(summary.totalHt)}</Text>
        </View>
        <View style={styles.closingRow}>
          <Text style={styles.closingLabel}>Total TVA</Text>
          <Text style={styles.closingValue}>{money(summary.totalVat)}</Text>
        </View>
        <View style={styles.closingRow}>
          <Text style={styles.closingLabel}>Total TTC facturé</Text>
          <Text style={styles.closingValue}>{money(summary.totalTtc)}</Text>
        </View>
        <View style={styles.closingRow}>
          <Text style={styles.closingLabel}>Notes de crédit</Text>
          <Text style={styles.closingValue}>{money(-summary.credited)}</Text>
        </View>
        <View style={styles.closingGrand}>
          <Text style={styles.closingGrandLabel}>TOTAL NET TTC</Text>
          <Text style={styles.closingGrandValue}>{money(summary.net)}</Text>
        </View>
        <Text style={styles.closingGenerated}>Document généré le {formatDateTime(generatedAt)}</Text>
      </View>
    </View>
  );
}

export function InvoicesListDocument({ data }) {
  const { filters, summary, rows, truncated, generatedAt } = data;
  return (
    <Document title="Factures — Meri Beauty" author="Meri Beauty" subject="Liste des factures émises">
      <Page size="A4" orientation="landscape" style={styles.page}>
        <Letterhead filters={filters} />
        <Footer generatedAt={generatedAt} />

        {truncated && (
          <View style={styles.notice}>
            <Text>Période trop large — ce document est limité aux 5 000 premières factures. Affinez les dates pour un relevé complet.</Text>
          </View>
        )}

        <View style={styles.synthesis}>
          <View style={styles.synthesisItem}>
            <Text style={styles.synthesisLabel}>Factures</Text>
            <Text style={styles.synthesisValue}>{summary.count}</Text>
          </View>
          <View style={styles.synthesisItem}>
            <Text style={styles.synthesisLabel}>Total TTC</Text>
            <Text style={styles.synthesisValue}>{money(summary.totalTtc)}</Text>
          </View>
          <View style={styles.synthesisItem}>
            <Text style={styles.synthesisLabel}>Notes de crédit</Text>
            <Text style={styles.synthesisValue}>{money(summary.credited)}</Text>
          </View>
        </View>

        <TableHead />
        {rows.length === 0 ? (
          <Text style={{ paddingVertical: 20, textAlign: "center", color: COLORS.muted }}>Aucune facture sur cette période.</Text>
        ) : (
          rows.map((row) => <DataRow key={row.number} row={row} />)
        )}

        <ClosingTotals summary={summary} generatedAt={generatedAt} />
      </Page>
    </Document>
  );
}
