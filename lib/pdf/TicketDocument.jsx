import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";

const styles = StyleSheet.create({
  page: { padding: 40, fontSize: 10, fontFamily: "Helvetica", color: "#222" },
  headerRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 28 },
  sellerName: { fontSize: 16, fontWeight: 700, marginBottom: 4 },
  muted: { color: "#666" },
  docTitle: { fontSize: 18, fontWeight: 700, textAlign: "right", marginBottom: 4 },
  docMeta: { textAlign: "right", color: "#666" },
  table: { marginTop: 8 },
  tableHeaderRow: {
    flexDirection: "row",
    borderBottom: "1 solid #222",
    paddingBottom: 6,
    marginBottom: 6,
    fontWeight: 700,
  },
  tableRow: { flexDirection: "row", paddingVertical: 5, borderBottom: "0.5 solid #eee" },
  colDescription: { flex: 4 },
  colQty: { flex: 1, textAlign: "center" },
  colUnitPrice: { flex: 1.5, textAlign: "right" },
  colTotal: { flex: 1.5, textAlign: "right" },
  totals: { marginTop: 16, alignItems: "flex-end" },
  totalsRow: { flexDirection: "row", width: 220, justifyContent: "space-between", paddingVertical: 2 },
  totalsLabel: { color: "#666" },
  grandTotalRow: {
    flexDirection: "row",
    width: 220,
    justifyContent: "space-between",
    marginTop: 6,
    paddingTop: 6,
    borderTop: "1 solid #222",
  },
  grandTotalLabel: { fontWeight: 700 },
  grandTotalValue: { fontWeight: 700 },
  footer: { position: "absolute", bottom: 32, left: 40, right: 40, fontSize: 8, color: "#999", textAlign: "center" },
});

function money(n) {
  return `${Number(n).toFixed(2)} €`;
}

function formatDate(d) {
  return new Date(d).toLocaleDateString("fr-BE", { day: "2-digit", month: "long", year: "numeric", timeZone: "Europe/Brussels" });
}

/**
 * A simplified receipt for an anonymous POS "client de passage" sale — no
 * customer identity block, unlike InvoiceDocument. Belgian VAT law doesn't
 * require a nominative invoice for an ordinary B2C retail sale; one is only
 * issued when the customer is actually identified (see issueInvoice's
 * callers) — an anonymous sale never has the name/email an Invoice requires.
 */
export function TicketDocument({ ticket }) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.sellerName}>{ticket.sellerName}</Text>
            {ticket.sellerAddress && <Text style={styles.muted}>{ticket.sellerAddress}</Text>}
            {ticket.sellerVatNumber && <Text style={styles.muted}>TVA : {ticket.sellerVatNumber}</Text>}
          </View>
          <View>
            <Text style={styles.docTitle}>TICKET DE CAISSE</Text>
            <Text style={styles.docMeta}>Vente n° {ticket.orderNumber}</Text>
            <Text style={styles.docMeta}>{formatDate(ticket.issuedAt)}</Text>
          </View>
        </View>

        <View style={styles.table}>
          <View style={styles.tableHeaderRow}>
            <Text style={styles.colDescription}>Description</Text>
            <Text style={styles.colQty}>Qté</Text>
            <Text style={styles.colUnitPrice}>Prix unitaire TTC</Text>
            <Text style={styles.colTotal}>Total TTC</Text>
          </View>
          {ticket.lines.map((line, i) => (
            <View style={styles.tableRow} key={i}>
              <Text style={styles.colDescription}>{line.description}</Text>
              <Text style={styles.colQty}>{line.quantity}</Text>
              <Text style={styles.colUnitPrice}>{money(line.unitPrice)}</Text>
              <Text style={styles.colTotal}>{money(line.unitPrice * line.quantity)}</Text>
            </View>
          ))}
        </View>

        <View style={styles.totals}>
          <View style={styles.totalsRow}>
            <Text style={styles.totalsLabel}>Sous-total (hors TVA)</Text>
            <Text>{money(ticket.subtotalExclVat)}</Text>
          </View>
          <View style={styles.totalsRow}>
            <Text style={styles.totalsLabel}>TVA ({Number(ticket.vatRate)}%)</Text>
            <Text>{money(ticket.vatAmount)}</Text>
          </View>
          <View style={styles.grandTotalRow}>
            <Text style={styles.grandTotalLabel}>Total TTC</Text>
            <Text style={styles.grandTotalValue}>{money(ticket.totalInclVat)}</Text>
          </View>
        </View>

        <Text style={styles.footer}>
          {ticket.sellerName}
          {ticket.sellerVatNumber ? ` — TVA ${ticket.sellerVatNumber}` : ""} — Vente n° {ticket.orderNumber}
        </Text>
      </Page>
    </Document>
  );
}
