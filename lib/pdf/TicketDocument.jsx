import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import { COLORS, formatDate, money } from "./theme";

/**
 * A simplified receipt for an anonymous POS "client de passage" sale — no
 * customer identity block, unlike InvoiceDocument. Belgian VAT law doesn't
 * require a nominative invoice for an ordinary B2C retail sale; one is only
 * issued when the customer is actually identified (see issueInvoice's
 * callers) — an anonymous sale never has the name/email an Invoice requires.
 *
 * Deliberately its OWN compact stylesheet rather than theme.jsx's A4 layout:
 * a till receipt printed on 80mm paper (or handed/emailed as a slip) looks
 * nothing like a full invoice — same brand tokens (COLORS, money, formatDate)
 * for a consistent look, but a narrow page, tight spacing and no legal
 * footer block, which a ticket doesn't carry anyway.
 */
const WIDTH = 227; // 80mm thermal-receipt width, in points (1mm ≈ 2.835pt)

const styles = StyleSheet.create({
  page: {
    width: WIDTH,
    paddingVertical: 16,
    paddingHorizontal: 14,
    fontSize: 8,
    fontFamily: "Helvetica",
    color: COLORS.text,
    lineHeight: 1.3,
  },
  center: { textAlign: "center" },
  shopName: { fontSize: 11, fontWeight: 700, color: COLORS.brand, textAlign: "center" },
  muted: { fontSize: 7, color: COLORS.muted, textAlign: "center" },
  dashedRule: {
    borderBottom: `0.75 dashed ${COLORS.hairline}`,
    marginVertical: 8,
  },
  title: { fontSize: 9, fontWeight: 700, letterSpacing: 0.6, textAlign: "center", marginBottom: 2 },
  meta: { fontSize: 7, color: COLORS.muted, textAlign: "center" },
  lineRow: { marginBottom: 5 },
  lineDescription: { fontSize: 8, color: COLORS.text },
  lineDetail: { flexDirection: "row", justifyContent: "space-between", marginTop: 1 },
  lineQtyUnit: { fontSize: 7, color: COLORS.muted },
  lineAmount: { fontSize: 8, fontWeight: 700 },
  totalsRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 1.5 },
  totalsLabel: { fontSize: 7.5, color: COLORS.muted },
  totalsValue: { fontSize: 7.5 },
  grandTotalRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 4 },
  grandTotalLabel: { fontSize: 9, fontWeight: 700 },
  grandTotalValue: { fontSize: 11, fontWeight: 700, color: COLORS.brand },
  notice: { fontSize: 6.5, color: COLORS.faint, textAlign: "center", marginTop: 10 },
  thanks: { fontSize: 8, fontWeight: 700, color: COLORS.brand, textAlign: "center", marginTop: 10 },
});

function Rule() {
  return <View style={styles.dashedRule} />;
}

// react-pdf has no "shrink page to content" option — a Page is always a
// fixed size, so a generic tall size (like a real till roll) would print
// mostly blank space for the common 1-3 item sale this is actually used for.
// Estimating the height from the line count instead keeps the page roughly
// as tall as its content. Underestimating is harmless: react-pdf just
// continues onto a same-size second page, exactly like any other document.
const BASE_HEIGHT = 300; // header + totals + footer, empty cart
const ITEM_HEIGHT = 26;
const LONG_DESCRIPTION_EXTRA = 10; // budget for a description wrapping to 2 lines

function estimateTicketHeight(lines) {
  return (
    BASE_HEIGHT +
    lines.reduce((sum, line) => sum + ITEM_HEIGHT + (line.description.length > 28 ? LONG_DESCRIPTION_EXTRA : 0), 0)
  );
}

export function TicketDocument({ ticket, contact = null }) {
  const pageHeight = estimateTicketHeight(ticket.lines);

  return (
    <Document title={`Ticket ${ticket.orderNumber}`} author={ticket.sellerName}>
      <Page size={[WIDTH, pageHeight]} style={styles.page}>
        <Text style={styles.shopName}>{ticket.sellerName}</Text>
        {ticket.sellerAddress ? <Text style={styles.muted}>{ticket.sellerAddress}</Text> : null}
        {ticket.sellerVatNumber ? <Text style={styles.muted}>TVA {ticket.sellerVatNumber}</Text> : null}

        <Rule />

        <Text style={styles.title}>TICKET DE CAISSE</Text>
        <Text style={styles.meta}>N° {ticket.orderNumber} — {formatDate(ticket.issuedAt)}</Text>

        <Rule />

        {ticket.lines.map((line, index) => {
          const total = line.lineTotal ?? line.unitPrice * line.quantity;
          return (
            <View style={styles.lineRow} key={line.id ?? index} wrap={false}>
              <Text style={styles.lineDescription}>{line.description}</Text>
              <View style={styles.lineDetail}>
                <Text style={styles.lineQtyUnit}>
                  {line.quantity} × {money(line.unitPrice)}
                </Text>
                <Text style={styles.lineAmount}>{money(total)}</Text>
              </View>
            </View>
          );
        })}

        <Rule />

        <View style={styles.totalsRow}>
          <Text style={styles.totalsLabel}>Sous-total HT</Text>
          <Text style={styles.totalsValue}>{money(ticket.subtotalExclVat)}</Text>
        </View>
        <View style={styles.totalsRow}>
          <Text style={styles.totalsLabel}>TVA ({Number(ticket.vatRate)} %)</Text>
          <Text style={styles.totalsValue}>{money(ticket.vatAmount)}</Text>
        </View>
        <View style={styles.grandTotalRow}>
          <Text style={styles.grandTotalLabel}>TOTAL TTC</Text>
          <Text style={styles.grandTotalValue}>{money(ticket.totalInclVat)}</Text>
        </View>

        <Rule />

        <Text style={styles.thanks}>Merci de votre visite !</Text>
        <Text style={styles.notice}>
          Ce ticket n&apos;est pas une facture nominative. Pour obtenir une facture à votre nom, présentez-vous en
          boutique avec ce document.
        </Text>
        <Text style={styles.notice}>
          Échange et retour sur présentation de ce ticket, dans les conditions affichées en boutique.
        </Text>
        {contact?.email ? <Text style={styles.notice}>{contact.email}</Text> : null}
      </Page>
    </Document>
  );
}
