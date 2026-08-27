import { Document, Page, Text, View } from "@react-pdf/renderer";
import {
  DocumentHeader,
  LegalFooter,
  LineItemsTable,
  SellerBlock,
  TermsBlock,
  TotalsBlock,
  formatDate,
  styles,
} from "./theme";

/**
 * A simplified receipt for an anonymous POS "client de passage" sale — no
 * customer identity block, unlike InvoiceDocument. Belgian VAT law doesn't
 * require a nominative invoice for an ordinary B2C retail sale; one is only
 * issued when the customer is actually identified (see issueInvoice's
 * callers) — an anonymous sale never has the name/email an Invoice requires.
 *
 * Shares the invoice's layout deliberately: the same shop hands both across
 * the same counter.
 */
export function TicketDocument({ ticket, contact = null }) {
  return (
    <Document title={`Ticket ${ticket.orderNumber}`} author={ticket.sellerName}>
      <Page size="A4" style={styles.page}>
        <DocumentHeader
          title="TICKET DE CAISSE"
          number={ticket.orderNumber}
          issuedAt={ticket.issuedAt}
          status={{ label: "PAYÉ EN BOUTIQUE", tone: "paid" }}
        />

        <View style={styles.parties}>
          <SellerBlock
            name={ticket.sellerName}
            address={ticket.sellerAddress}
            vatNumber={ticket.sellerVatNumber}
            contact={contact}
          />
          <View style={styles.partyGutter} />
          <View style={styles.partyColumn} />
        </View>

        <LineItemsTable lines={ticket.lines} title="DÉTAIL DE LA VENTE" />

        <View style={styles.bottom}>
          <TermsBlock
            items={[
              { label: "Vente", value: `N° ${ticket.orderNumber} du ${formatDate(ticket.issuedAt)}` },
              { label: "Devise", value: "Euro (EUR)" },
              {
                label: "Échange et retour",
                value: "Sur présentation de ce ticket, dans les conditions affichées en boutique.",
              },
              contact?.email ? { label: "Contact", value: contact.email } : null,
            ].filter(Boolean)}
          />
          <TotalsBlock
            subtotalExclVat={ticket.subtotalExclVat}
            vatRate={ticket.vatRate}
            vatAmount={ticket.vatAmount}
            totalInclVat={ticket.totalInclVat}
          />
        </View>

        <Text style={{ fontSize: 7.5, color: "#7A7A72", marginTop: 16, textAlign: "center" }}>
          Ce ticket n'est pas une facture nominative. Pour obtenir une facture à votre nom, présentez-vous en boutique
          avec ce document.
        </Text>

        <LegalFooter
          sellerName={ticket.sellerName}
          sellerAddress={ticket.sellerAddress}
          sellerVatNumber={ticket.sellerVatNumber}
          contact={contact}
          reference={`Vente ${ticket.orderNumber}`}
        />
      </Page>
    </Document>
  );
}
