import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";

const styles = StyleSheet.create({
  page: { padding: 40, fontSize: 10, fontFamily: "Helvetica", color: "#222" },
  headerRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 28 },
  sellerName: { fontSize: 16, fontWeight: 700, marginBottom: 4 },
  muted: { color: "#666" },
  docTitle: { fontSize: 18, fontWeight: 700, textAlign: "right", marginBottom: 4 },
  docMeta: { textAlign: "right", color: "#666" },
  partiesRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 24 },
  partyLabel: { color: "#999", fontSize: 8, textTransform: "uppercase", marginBottom: 4, letterSpacing: 0.5 },
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
  creditNoteBanner: {
    marginBottom: 16,
    padding: 8,
    backgroundColor: "#fdf2f2",
    color: "#a33",
    fontSize: 9,
  },
});

function money(n) {
  return `${Number(n).toFixed(2)} €`;
}

function formatDate(d) {
  return new Date(d).toLocaleDateString("fr-BE", { day: "2-digit", month: "long", year: "numeric" });
}

export function InvoiceDocument({ invoice }) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.sellerName}>{invoice.sellerName}</Text>
            {invoice.sellerAddress && <Text style={styles.muted}>{invoice.sellerAddress}</Text>}
            {invoice.sellerVatNumber && <Text style={styles.muted}>TVA : {invoice.sellerVatNumber}</Text>}
          </View>
          <View>
            <Text style={styles.docTitle}>FACTURE</Text>
            <Text style={styles.docMeta}>N° {invoice.number}</Text>
            <Text style={styles.docMeta}>{formatDate(invoice.issuedAt)}</Text>
          </View>
        </View>

        <View style={styles.partiesRow}>
          <View>
            <Text style={styles.partyLabel}>Facturé à</Text>
            <Text>{invoice.customerName}</Text>
            <Text style={styles.muted}>{invoice.customerEmail}</Text>
            {invoice.customerVatNumber && <Text style={styles.muted}>TVA : {invoice.customerVatNumber}</Text>}
            {invoice.customerAddress && <Text style={styles.muted}>{invoice.customerAddress}</Text>}
          </View>
        </View>

        <View style={styles.table}>
          <View style={styles.tableHeaderRow}>
            <Text style={styles.colDescription}>Description</Text>
            <Text style={styles.colQty}>Qté</Text>
            <Text style={styles.colUnitPrice}>Prix unitaire</Text>
            <Text style={styles.colTotal}>Total</Text>
          </View>
          {invoice.lines.map((line) => (
            <View style={styles.tableRow} key={line.id}>
              <Text style={styles.colDescription}>{line.description}</Text>
              <Text style={styles.colQty}>{line.quantity}</Text>
              <Text style={styles.colUnitPrice}>{money(line.unitPrice)}</Text>
              <Text style={styles.colTotal}>{money(line.lineTotal)}</Text>
            </View>
          ))}
        </View>

        <View style={styles.totals}>
          <View style={styles.totalsRow}>
            <Text style={styles.totalsLabel}>Sous-total (hors TVA)</Text>
            <Text>{money(invoice.subtotalExclVat)}</Text>
          </View>
          <View style={styles.totalsRow}>
            <Text style={styles.totalsLabel}>TVA ({Number(invoice.vatRate)}%)</Text>
            <Text>{money(invoice.vatAmount)}</Text>
          </View>
          <View style={styles.grandTotalRow}>
            <Text style={styles.grandTotalLabel}>Total TTC</Text>
            <Text style={styles.grandTotalValue}>{money(invoice.totalInclVat)}</Text>
          </View>
        </View>

        <Text style={styles.footer}>
          {invoice.sellerName}
          {invoice.sellerVatNumber ? ` — TVA ${invoice.sellerVatNumber}` : ""} — Facture n° {invoice.number}
        </Text>
      </Page>
    </Document>
  );
}

export function CreditNoteDocument({ creditNote, invoice }) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.sellerName}>{invoice.sellerName}</Text>
            {invoice.sellerAddress && <Text style={styles.muted}>{invoice.sellerAddress}</Text>}
            {invoice.sellerVatNumber && <Text style={styles.muted}>TVA : {invoice.sellerVatNumber}</Text>}
          </View>
          <View>
            <Text style={styles.docTitle}>NOTE DE CRÉDIT</Text>
            <Text style={styles.docMeta}>N° {creditNote.number}</Text>
            <Text style={styles.docMeta}>{formatDate(creditNote.issuedAt)}</Text>
          </View>
        </View>

        <Text style={styles.creditNoteBanner}>
          Se rapporte à la facture n° {invoice.number} du {formatDate(invoice.issuedAt)}
          {creditNote.reason ? ` — Motif : ${creditNote.reason}` : ""}
        </Text>

        <View style={styles.partiesRow}>
          <View>
            <Text style={styles.partyLabel}>Émis à l'attention de</Text>
            <Text>{invoice.customerName}</Text>
            <Text style={styles.muted}>{invoice.customerEmail}</Text>
          </View>
        </View>

        <View style={styles.totals}>
          <View style={styles.grandTotalRow}>
            <Text style={styles.grandTotalLabel}>Montant crédité (TTC)</Text>
            <Text style={styles.grandTotalValue}>{money(creditNote.totalInclVat)}</Text>
          </View>
        </View>

        <Text style={styles.footer}>
          {invoice.sellerName}
          {invoice.sellerVatNumber ? ` — TVA ${invoice.sellerVatNumber}` : ""} — Note de crédit n° {creditNote.number}
        </Text>
      </Page>
    </Document>
  );
}
