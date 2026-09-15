import fs from "node:fs";
import path from "node:path";
import { Document, Page, View, Text, Image, StyleSheet } from "@react-pdf/renderer";
import { COLORS, money, formatDate } from "./theme";
import { groupLedgerRowsByDay, formatDayLabel } from "@/lib/cash-book/day-groups";

/**
 * The printable Livre de caisse — a real generated PDF (logo, real
 * pagination, "généré le" timestamp), not a browser print of the dashboard
 * screen. Same landscape-A4 letterhead/footer pattern as
 * RecettesJournalDocument.jsx (copied rather than shared, same reasoning:
 * tweaking one must never regress the other).
 *
 * Journal only — entrées/sorties/solde, day by day. The inline "Rapport"
 * section CaisseClient.jsx renders on screen (category/VAT breakdown,
 * comparison, session detail) used to be included here too, but the client's
 * explicit ask (14 Sep 2026) is that printing this book stays what it always
 * was to them: the days and their values, nothing else.
 */
const LOGO_BUFFER = fs.readFileSync(path.join(process.cwd(), "public", "Images", "Logo.png"));

// Not in the shared theme (theme.jsx's COLORS.credit is red-only) — Apport
// rows read as money safely in the drawer, same green convention as the
// on-screen journal (CaisseClient.jsx's ROW_TINTS).
const GREEN = "#2F7D4F";

const ROW_COLORS = {
  CASH_IN: GREEN,
  EXPENSE: COLORS.credit,
  WITHDRAWAL: COLORS.credit,
  REFUND: COLORS.credit,
};

const NEGATIVE_DISPLAY_KINDS = new Set(["EXPENSE", "WITHDRAWAL"]);

/** Same free-text cap as RecettesJournalDocument.jsx — see its own comment for why. */
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

  // ─── Notices / synthèse (regular flow) ────────────────────────────────
  synthesis: { flexDirection: "row", marginBottom: 12 },
  synthesisItem: { flex: 1, paddingRight: 10 },
  synthesisLabel: { fontSize: 6.5, letterSpacing: 0.5, color: COLORS.muted, textTransform: "uppercase" },
  synthesisValue: { fontSize: 11, fontWeight: 700, color: COLORS.brand, marginTop: 2 },

  // ─── Journal table ─────────────────────────────────────────────────────
  tableHead: {
    flexDirection: "row",
    backgroundColor: COLORS.panel,
    paddingVertical: 4,
    paddingHorizontal: 6,
    marginTop: 8,
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
  colDate: { flex: 1.4, overflow: "hidden" },
  colPiece: { flex: 1.2, overflow: "hidden" },
  colRef: { flex: 1, overflow: "hidden" },
  colLabel: { flex: 4.6 },
  // The day header row has no other columns in it (see DayBlock) — this
  // widens the label to the row's full width instead of leaving it capped
  // at colLabel's own share, which would strand blank space where the
  // now-removed duplicate totals used to sit.
  dayRowLabel: { flex: 1 },
  colEntree: { flex: 1.1, textAlign: "right" },
  colSortie: { flex: 1.1, textAlign: "right" },
  colSolde: { flex: 1.2, textAlign: "right" },
});

function Letterhead({ filters }) {
  return (
    <View style={styles.header} fixed>
      <View style={styles.headerBrand}>
        {/* eslint-disable-next-line jsx-a11y/alt-text */}
        <Image src={LOGO_BUFFER} style={styles.logo} />
        <View style={styles.headerBrandText}>
          <Text style={styles.headerTitle}>Meri Beauty</Text>
          <Text style={styles.headerSubtitle}>Livre de caisse</Text>
        </View>
      </View>
      <View style={styles.headerMeta}>
        <Text style={styles.headerMetaLine}>
          <Text style={styles.headerMetaLabel}>Période : </Text>
          Du {filters.from} au {filters.to}
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
      <Text style={[styles.tableHeadCell, styles.colPiece]}>N° PIÈCE</Text>
      <Text style={[styles.tableHeadCell, styles.colRef]}>RÉF.</Text>
      <Text style={[styles.tableHeadCell, styles.colLabel]}>DÉSIGNATION</Text>
      <Text style={[styles.tableHeadCell, styles.colEntree]}>ENTRÉES</Text>
      <Text style={[styles.tableHeadCell, styles.colSortie]}>SORTIES</Text>
      <Text style={[styles.tableHeadCell, styles.colSolde]}>SOLDE</Text>
    </View>
  );
}

function DataRow({ row, index }) {
  const color = ROW_COLORS[row.kind];
  const sortieValue = row.sortie ? (NEGATIVE_DISPLAY_KINDS.has(row.kind) ? -row.sortie : row.sortie) : null;
  return (
    <View style={styles.dataRow} wrap={false}>
      <Text style={styles.colDate}>
        {new Date(row.date).toLocaleString("fr-BE", {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          timeZone: "Europe/Brussels",
        })}
      </Text>
      <Text style={styles.colPiece}>{truncate(row.pieceNumber, 18) || "—"}</Text>
      <Text style={styles.colRef}>{truncate(row.reference, 14) || "—"}</Text>
      <Text style={[styles.colLabel, color && { color }]}>{row.label}</Text>
      <Text style={[styles.colEntree, color && { color }]}>{row.entree ? money(row.entree) : "—"}</Text>
      <Text style={[styles.colSortie, color && { color }]}>{sortieValue != null ? money(sortieValue) : "—"}</Text>
      <Text style={[styles.colSolde, styles.bold]}>{money(row.solde)}</Text>
    </View>
  );
}

function DayBlock({ group }) {
  return (
    <View>
      {/* Day header carries only the label — the totals used to be repeated
          here AND on "Total du jour" below, printing the same three numbers
          twice for every day and reading as if the two rows disagreed. */}
      <View style={styles.dayRow} wrap={false}>
        <Text style={[styles.colLabel, styles.bold, styles.dayRowLabel]}>
          {formatDayLabel(group.date)} ({group.rows.length} mouvement{group.rows.length > 1 ? "s" : ""})
        </Text>
      </View>
      {group.rows.map((row, index) => (
        <DataRow key={`${row.kind}-${row.pieceNumber ?? index}-${row.date}`} row={row} index={index} />
      ))}
      <View style={styles.totalRow} wrap={false}>
        <Text style={styles.colDate} />
        <Text style={styles.colPiece} />
        <Text style={styles.colRef} />
        <Text style={[styles.colLabel, styles.bold]}>Total du jour</Text>
        <Text style={[styles.colEntree, styles.bold]}>{money(group.totalEntrees)}</Text>
        <Text style={[styles.colSortie, styles.bold]}>{money(group.totalSorties)}</Text>
        <Text style={[styles.colSolde, styles.bold]}>{money(group.closingBalance)}</Text>
      </View>
    </View>
  );
}

/**
 * @param {{ ledger: ReturnType<typeof import("@/lib/cash-book/build-ledger").buildCashBookLedger>,
 *   generatedAt: Date }} props
 */
export function CashBookDocument({ ledger, generatedAt }) {
  const { filters, totals, rows } = ledger;
  const dayGroups = groupLedgerRowsByDay(rows);

  return (
    <Document title="Livre de caisse — Meri Beauty" author="Meri Beauty" subject="Journal chronologique de caisse">
      <Page size="A4" orientation="landscape" style={styles.page}>
        <Letterhead filters={filters} />
        <Footer generatedAt={generatedAt} />

        <View style={styles.synthesis}>
          <View style={styles.synthesisItem}>
            <Text style={styles.synthesisLabel}>Total entrées</Text>
            <Text style={styles.synthesisValue}>{money(totals.entrees)}</Text>
          </View>
          <View style={styles.synthesisItem}>
            <Text style={styles.synthesisLabel}>Total sorties</Text>
            <Text style={styles.synthesisValue}>{money(totals.sorties)}</Text>
          </View>
          <View style={styles.synthesisItem}>
            <Text style={styles.synthesisLabel}>Solde</Text>
            <Text style={styles.synthesisValue}>{money(totals.finalBalance)}</Text>
          </View>
          <View style={styles.synthesisItem}>
            <Text style={styles.synthesisLabel}>Écritures</Text>
            <Text style={styles.synthesisValue}>{rows.length}</Text>
          </View>
        </View>

        <TableHead />
        {dayGroups.length === 0 ? (
          <Text style={{ paddingVertical: 20, textAlign: "center", color: COLORS.muted }}>
            Aucun mouvement sur cette période.
          </Text>
        ) : (
          dayGroups.map((group) => <DayBlock key={group.key} group={group} />)
        )}
      </Page>
    </Document>
  );
}
