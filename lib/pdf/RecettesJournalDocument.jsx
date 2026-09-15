import fs from "node:fs";
import path from "node:path";
import { Document, Page, View, Text, Image, StyleSheet } from "@react-pdf/renderer";
import { COLORS, money, formatDate } from "./theme";
import { groupRowsByDay, formatDayLabel } from "@/lib/livre-de-recettes/day-groups";

/**
 * The printable Livre de recettes — a real generated PDF, not a browser
 * print of the dashboard screen. Landscape A4: the journal has nine columns
 * and a portrait page (the shape every other document in lib/pdf/ uses)
 * would crush them.
 *
 * @react-pdf/image only decodes PNG/JPEG/SVG (see lib/pdf/theme.jsx's
 * comment on the 14 standard fonts for the same reasoning) — the site's real
 * logo is public/Images/Logo.webp, so a PNG twin is committed alongside it
 * and read once here as a Buffer, which is one of react-pdf's supported
 * `Image` src forms and needs no runtime conversion.
 */
const LOGO_BUFFER = fs.readFileSync(path.join(process.cwd(), "public", "Images", "Logo.png"));

/**
 * A hard character cap for any table cell holding free text of unpredictable
 * length — a Stripe payment-intent id in "Pièce / Réf.", or a long client
 * name in "Client". `overflow: hidden` alone isn't enough: react-pdf's text
 * layout decides whether a value wraps to a second line based on its own
 * width measurement, and that measurement doesn't always agree with the
 * column's actual flex width — a value can be judged "fits on one line" and
 * render straight past the column into whatever sits next to it, with
 * `overflow: hidden` never engaging because no wrap point was chosen. Seen
 * for real, twice: a Stripe id running into the client name, and a client
 * name ending in a hyphenated test suffix running into the category. Capping
 * the source string removes the renderer's judgment call entirely — the
 * reference/name is never the reader's only way to find the transaction,
 * the date/client/category context around it is.
 */
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

  // ─── Fixed letterhead (every page) ────────────────────────────────────
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

  // ─── Fixed footer (every page) ────────────────────────────────────────
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

  // ─── Notices / synthèse (page 1 only, regular flow) ───────────────────
  notice: {
    borderLeft: `2 solid ${COLORS.gold}`,
    backgroundColor: COLORS.panel,
    paddingVertical: 5,
    paddingHorizontal: 8,
    marginBottom: 10,
    fontSize: 7.5,
    color: COLORS.text,
  },
  synthesis: { flexDirection: "row", marginBottom: 12 },
  synthesisItem: { flex: 1, paddingRight: 10 },
  synthesisLabel: { fontSize: 6.5, letterSpacing: 0.5, color: COLORS.muted, textTransform: "uppercase" },
  synthesisValue: { fontSize: 11, fontWeight: 700, color: COLORS.brand, marginTop: 2 },

  // ─── Table ─────────────────────────────────────────────────────────────
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
  totalRow: {
    flexDirection: "row",
    paddingVertical: 4,
    paddingHorizontal: 6,
    borderTop: `0.5 solid ${COLORS.hairline}`,
  },
  dataRow: {
    flexDirection: "row",
    paddingVertical: 3,
    paddingHorizontal: 6,
    borderBottom: `0.5 solid ${COLORS.hairline}`,
  },
  bold: { fontWeight: 700 },
  // A Stripe payment-intent id or an E2E test reference has no spaces for
  // react-pdf's layout to wrap at, so without a width cap it renders straight
  // past the column into whatever sits next to it (seen for real: "pi_3UAp…
  // …marwane" bleeding the reference into the client column). overflow:
  // hidden is the backstop for any column holding free text of unknown
  // length — the reference itself is also explicitly truncated below since
  // relying on clipping alone left a jagged, uneven edge.
  colDate: { flex: 1.3, overflow: "hidden" },
  colPiece: { flex: 1.1, overflow: "hidden" },
  colClient: { flex: 1.6, overflow: "hidden" },
  colCategory: { flex: 1.1, overflow: "hidden" },
  colMethod: { flex: 1.1, overflow: "hidden" },
  colLabel: { flex: 6.2 },
  colHt: { flex: 1, textAlign: "right" },
  colVat: { flex: 1, textAlign: "right" },
  colTtc: { flex: 1.1, textAlign: "right" },
  colBalance: { flex: 1.2, textAlign: "right" },
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
          <Text style={styles.headerSubtitle}>Livre de recettes</Text>
        </View>
      </View>
      <View style={styles.headerMeta}>
        <Text style={styles.headerMetaLine}>
          <Text style={styles.headerMetaLabel}>Période : </Text>
          Du {filters.from} au {filters.to}
        </Text>
        <Text style={styles.headerMetaLine}>
          <Text style={styles.headerMetaLabel}>Moyen de paiement : </Text>
          {filters.methodLabel}
        </Text>
        <Text style={styles.headerMetaLine}>
          <Text style={styles.headerMetaLabel}>Catégorie : </Text>
          {filters.categoryLabel}
        </Text>
      </View>
    </View>
  );
}

function Footer({ generatedAt }) {
  return (
    <View style={styles.footer} fixed>
      <Text style={styles.footerText}>Généré le {formatDate(generatedAt)} — Meri Beauty</Text>
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
      <Text style={[styles.tableHeadCell, styles.colPiece]}>PIÈCE / RÉF.</Text>
      <Text style={[styles.tableHeadCell, styles.colClient]}>CLIENT</Text>
      <Text style={[styles.tableHeadCell, styles.colCategory]}>CATÉGORIE</Text>
      <Text style={[styles.tableHeadCell, styles.colMethod]}>MÉTHODE</Text>
      <Text style={[styles.tableHeadCell, styles.colHt]}>HT</Text>
      <Text style={[styles.tableHeadCell, styles.colVat]}>TVA</Text>
      <Text style={[styles.tableHeadCell, styles.colTtc]}>TTC</Text>
      <Text style={[styles.tableHeadCell, styles.colBalance]}>SOLDE CUMULÉ</Text>
    </View>
  );
}

function DataRow({ row }) {
  const sign = row.isRefund ? -1 : 1;
  return (
    <View style={styles.dataRow} wrap={false}>
      <Text style={styles.colDate}>
        {new Date(row.paidAt).toLocaleString("fr-BE", {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          timeZone: "Europe/Brussels",
        })}
      </Text>
      <Text style={styles.colPiece}>{truncate(row.pieceNumber || row.reference, 18) || "—"}</Text>
      <Text style={styles.colClient}>{truncate(row.customerName, 30) ?? "—"}</Text>
      <Text style={styles.colCategory}>{row.categoryLabel}</Text>
      <Text style={styles.colMethod}>
        {row.methodLabel}
        {row.offTill ? " (hors caisse)" : ""}
      </Text>
      <Text style={styles.colHt}>{money(sign * row.amountHt)}</Text>
      <Text style={styles.colVat}>{money(sign * row.amountVat)}</Text>
      <Text style={[styles.colTtc, row.isRefund && { color: COLORS.credit }]}>{money(sign * row.amountTtc)}</Text>
      <Text style={styles.colBalance}>{money(row.runningTotal)}</Text>
    </View>
  );
}

function DayBlock({ group }) {
  return (
    <View>
      <View style={styles.dayRow} wrap={false}>
        <Text style={[styles.colLabel, styles.bold]}>
          {formatDayLabel(group.date)} ({group.rows.length} écriture{group.rows.length > 1 ? "s" : ""})
        </Text>
        <Text style={[styles.colHt, styles.bold]}>{money(group.totalHt)}</Text>
        <Text style={[styles.colVat, styles.bold]}>{money(group.totalVat)}</Text>
        <Text style={[styles.colTtc, styles.bold]}>{money(group.totalTtc)}</Text>
        <Text style={[styles.colBalance, styles.bold]}>{money(group.closingBalance)}</Text>
      </View>
      {group.rows.map((row) => (
        <DataRow key={row.id} row={row} />
      ))}
      <View style={styles.totalRow} wrap={false}>
        <Text style={[styles.colLabel, styles.bold]}>Total du jour</Text>
        <Text style={[styles.colHt, styles.bold]}>{money(group.totalHt)}</Text>
        <Text style={[styles.colVat, styles.bold]}>{money(group.totalVat)}</Text>
        <Text style={[styles.colTtc, styles.bold]}>{money(group.totalTtc)}</Text>
        <Text style={[styles.colBalance, styles.bold]}>{money(group.closingBalance)}</Text>
      </View>
    </View>
  );
}

/** @param {ReturnType<typeof import("@/lib/livre-de-recettes/build-recettes-journal").buildRecettesJournal>} journal */
export function RecettesJournalDocument({ journal }) {
  const { filters, summary, rows, truncated, generatedAt } = journal;
  const dayGroups = groupRowsByDay(rows);

  return (
    <Document title="Livre de recettes — Meri Beauty" author="Meri Beauty" subject="Journal chronologique des recettes">
      <Page size="A4" orientation="landscape" style={styles.page}>
        <Letterhead filters={filters} />
        <Footer generatedAt={generatedAt} />

        {truncated && (
          <View style={styles.notice}>
            <Text>
              Période trop large — ce document est limité aux 5 000 premières écritures. Affinez les dates
              pour un relevé complet.
            </Text>
          </View>
        )}

        <View style={styles.synthesis}>
          <View style={styles.synthesisItem}>
            <Text style={styles.synthesisLabel}>Total net des recettes</Text>
            <Text style={styles.synthesisValue}>{money(summary.total)}</Text>
          </View>
          <View style={styles.synthesisItem}>
            <Text style={styles.synthesisLabel}>Recettes brutes</Text>
            <Text style={styles.synthesisValue}>{money(summary.grossInflow)}</Text>
          </View>
          <View style={styles.synthesisItem}>
            <Text style={styles.synthesisLabel}>Remboursements</Text>
            <Text style={styles.synthesisValue}>{money(summary.refundTotal)}</Text>
          </View>
          <View style={styles.synthesisItem}>
            <Text style={styles.synthesisLabel}>Écritures</Text>
            <Text style={styles.synthesisValue}>{summary.count}</Text>
          </View>
        </View>

        <TableHead />
        {dayGroups.length === 0 ? (
          <Text style={{ paddingVertical: 20, textAlign: "center", color: COLORS.muted }}>
            Aucune recette sur cette période.
          </Text>
        ) : (
          dayGroups.map((group) => <DayBlock key={group.key} group={group} />)
        )}
      </Page>
    </Document>
  );
}
