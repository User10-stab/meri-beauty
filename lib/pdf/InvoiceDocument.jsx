import { Document, Page, Text, View } from "@react-pdf/renderer";
import {
  BuyerBlock,
  DocumentHeader,
  LegalFooter,
  LineItemsTable,
  SellerBlock,
  TermsBlock,
  TotalsBlock,
  formatDate,
  money,
  styles,
} from "./theme";

const REVERSE_CHARGE_FOOTER_NOTE = "Autoliquidation Art 21 § 2 du code TVA belge";

/**
 * Payment status is only shown when the settlement data actually travelled
 * with the invoice — an unqualified "payée" printed from an assumption is
 * the kind of claim a customer would be right to hold us to.
 */
function paymentStatus(payment) {
  if (!payment?.paidAt) return null;
  return { label: "PAYÉE", tone: "paid" };
}

function paymentLine(payment) {
  if (!payment?.paidAt) return null;
  const method = payment.transactionReference ? "carte bancaire (Stripe)" : "sur place";
  return `Réglée le ${formatDate(payment.paidAt)} par ${method}`;
}

export function InvoiceDocument({ invoice, contact = null }) {
  const payment = invoice.payment ?? null;

  return (
    <Document
      title={`Facture ${invoice.number}`}
      author={invoice.sellerName}
      subject={`Facture ${invoice.number} — ${invoice.customerName}`}
    >
      <Page size="A4" style={styles.page}>
        <DocumentHeader
          title="FACTURE"
          number={invoice.number}
          issuedAt={invoice.issuedAt}
          status={paymentStatus(payment)}
        />

        <View style={styles.parties}>
          <SellerBlock
            name={invoice.sellerName}
            address={invoice.sellerAddress}
            vatNumber={invoice.sellerVatNumber}
            contact={contact}
          />
          <View style={styles.partyGutter} />
          <BuyerBlock invoice={invoice} />
        </View>

        {/* vatRate is only the fallback divisor for invoices issued before
            InvoiceLine carried its net twin — newer lines print their own
            stored figures and ignore it. */}
        <LineItemsTable lines={invoice.lines} vatRate={invoice.vatRate} />

        <View style={styles.bottom}>
          <TermsBlock
            items={[
              { label: "Règlement", value: paymentLine(payment) ?? "Paiement sécurisé — dû à réception de la facture" },
              { label: "Devise", value: "Euro (EUR)" },
              contact?.rib ? { label: "Compte bancaire (RIB)", value: contact.rib } : null,
              contact?.email ? { label: "Questions sur cette facture", value: contact.email } : null,
              contact?.website ? { label: "Conditions générales", value: `${contact.website}/conditions-generales` } : null,
            ].filter(Boolean)}
          />
          <TotalsBlock
            subtotalExclVat={invoice.subtotalExclVat}
            vatRate={invoice.vatRate}
            vatAmount={invoice.vatAmount}
            totalInclVat={invoice.totalInclVat}
          />
        </View>

        <LegalFooter
          legalNote={
            invoice.vatTreatment === "EU_REVERSE_CHARGE"
              ? REVERSE_CHARGE_FOOTER_NOTE
              : invoice.taxNote
          }
          sellerName={invoice.sellerName}
          sellerAddress={invoice.sellerAddress}
          sellerVatNumber={invoice.sellerVatNumber}
          contact={contact}
          reference={`Facture ${invoice.number}`}
        />
      </Page>
    </Document>
  );
}

export function CreditNoteDocument({ creditNote, invoice, contact = null }) {
  const isPartial = Number(creditNote.totalInclVat) < Number(invoice.totalInclVat);

  return (
    <Document
      title={`Note de crédit ${creditNote.number}`}
      author={invoice.sellerName}
      subject={`Note de crédit ${creditNote.number} — facture ${invoice.number}`}
    >
      <Page size="A4" style={styles.page}>
        <DocumentHeader
          title="NOTE DE CRÉDIT"
          number={creditNote.number}
          issuedAt={creditNote.issuedAt}
          status={{ label: isPartial ? "CRÉDIT PARTIEL" : "CRÉDIT TOTAL", tone: "credit" }}
        />

        <Text style={styles.creditNotice}>
          Se rapporte à la facture n° {invoice.number} du {formatDate(invoice.issuedAt)} (total {money(invoice.totalInclVat)})
          {creditNote.reason ? ` — Motif : ${creditNote.reason}` : ""}
        </Text>

        <View style={styles.parties}>
          <SellerBlock
            name={invoice.sellerName}
            address={invoice.sellerAddress}
            vatNumber={invoice.sellerVatNumber}
            contact={contact}
          />
          <View style={styles.partyGutter} />
          <BuyerBlock invoice={invoice} title="ÉMISE À L'ATTENTION DE" />
        </View>

        <View style={styles.bottom}>
          <TermsBlock
            items={[
              { label: "Document corrigé", value: `Facture n° ${invoice.number} du ${formatDate(invoice.issuedAt)}` },
              { label: "Motif", value: creditNote.reason || "Annulation / retour" },
              { label: "Devise", value: "Euro (EUR)" },
              contact?.rib ? { label: "Compte bancaire (RIB)", value: contact.rib } : null,
              contact?.email ? { label: "Questions sur ce document", value: contact.email } : null,
            ].filter(Boolean)}
          />
          <TotalsBlock
            subtotalExclVat={creditNote.subtotalExclVat}
            vatRate={creditNote.vatRate}
            vatAmount={creditNote.vatAmount}
            totalInclVat={creditNote.totalInclVat}
            grandTotalLabel="MONTANT CRÉDITÉ TTC"
          />
        </View>

        <LegalFooter
          legalNote={invoice.taxNote}
          sellerName={invoice.sellerName}
          sellerAddress={invoice.sellerAddress}
          sellerVatNumber={invoice.sellerVatNumber}
          contact={contact}
          reference={`Note de crédit ${creditNote.number}`}
        />
      </Page>
    </Document>
  );
}
