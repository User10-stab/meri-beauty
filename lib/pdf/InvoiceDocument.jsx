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
import { REVERSE_CHARGE_NOTE } from "@/lib/tax-policy";

/**
 * Printed on the footer of every invoice and credit note — B2C and B2B,
 * domestic and intra-Community alike — at the client's explicit request
 * (2026-08-28), who intends to narrow it later.
 *
 * This deliberately overrides `invoice.taxNote`. That column is still
 * snapshotted per transaction and is still only ever set for a genuine
 * intra-Community supply (lib/tax-policy.js), so the database record of what
 * actually applied to each sale is unaffected — only what gets rendered
 * changes. Note that PDFs are rendered on demand, so already-issued invoices
 * show the mention too the next time they are opened or re-sent.
 *
 * To go back to printing it only where it legally applies, restore:
 *   invoice.vatTreatment === "EU_REVERSE_CHARGE" ? REVERSE_CHARGE_NOTE : invoice.taxNote
 */
const FOOTER_LEGAL_NOTE = REVERSE_CHARGE_NOTE;

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
          legalNote={FOOTER_LEGAL_NOTE}
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
              contact?.email ? { label: "Questions sur ce document", value: contact.email } : null,
            ].filter(Boolean)}
          />
          <TotalsBlock
            // Stored positive (a magnitude, like every other money column in
            // this codebase) — negated only here, at render time, so the
            // document itself reads unambiguously as money leaving, not a
            // second sale.
            subtotalExclVat={-Number(creditNote.subtotalExclVat)}
            vatRate={creditNote.vatRate}
            vatAmount={-Number(creditNote.vatAmount)}
            totalInclVat={-Number(creditNote.totalInclVat)}
            grandTotalLabel="MONTANT CRÉDITÉ TTC"
          />
        </View>

        {/* Same mention as the invoice it corrects — a credit note that
            contradicted its own parent invoice would be worse than either. */}
        <LegalFooter
          legalNote={FOOTER_LEGAL_NOTE}
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
