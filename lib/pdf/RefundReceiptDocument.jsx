import { Document, Page, Text, View } from "@react-pdf/renderer";
import { DocumentHeader, LegalFooter, PartyRow, SellerBlock, formatDate, money, styles } from "./theme";

const METHOD_LABEL = {
  ONLINE: "Carte bancaire (en ligne)",
  CARD: "Carte bancaire (terminal)",
  CASH: "Espèces",
};

/**
 * Non-VAT evidence for a B2C refund. This is intentionally not a credit
 * note: no invoice existed to correct. It is rendered only after all refund
 * legs are settled and carries its own RB number.
 */
export function RefundReceiptDocument({ receipt, contact = null }) {
  const total = receipt.legs.reduce((sum, leg) => sum + Number(leg.settledAmount ?? leg.amount), 0);
  return (
    <Document title={`Justificatif de remboursement ${receipt.number}`} author={receipt.sellerName}>
      <Page size="A4" style={styles.page}>
        <DocumentHeader
          title="JUSTIFICATIF DE REMBOURSEMENT"
          number={receipt.number}
          issuedAt={receipt.issuedAt}
          status={{ label: "REMBOURSÉ", tone: "credit" }}
        />
        <View style={styles.parties}>
          <SellerBlock
            name={receipt.sellerName}
            address={receipt.sellerAddress}
            vatNumber={receipt.sellerVatNumber}
            rib={contact?.rib}
            contact={contact}
          />
          <View style={styles.partyGutter} />
          <View style={styles.partyColumn}>
            <Text style={styles.sectionTitle}>CLIENT</Text>
            <PartyRow label="Nom" value={receipt.customerName} strong />
            <PartyRow label="E-mail" value={receipt.customerEmail} />
          </View>
        </View>
        <View>
          <Text style={styles.sectionTitle}>REMBOURSEMENT</Text>
          <View style={styles.tableHead}>
            <Text style={[styles.tableHeadCell, { flex: 3 }]}>ORIGINE</Text>
            <Text style={[styles.tableHeadCell, { flex: 2 }]}>MÉTHODE</Text>
            <Text style={[styles.tableHeadCell, { flex: 1.5, textAlign: "right" }]}>MONTANT</Text>
          </View>
          {receipt.legs.map((leg, index) => (
            <View style={styles.tableRow} key={`${leg.method}-${index}`} wrap={false}>
              <Text style={{ flex: 3 }}>{receipt.itemLabel}</Text>
              <Text style={{ flex: 2 }}>{METHOD_LABEL[leg.method] ?? leg.method}</Text>
              <Text style={{ flex: 1.5, textAlign: "right", fontWeight: 700 }}>{money(leg.settledAmount ?? leg.amount)}</Text>
            </View>
          ))}
          <View style={styles.grandTotal}>
            <Text style={styles.grandTotalLabel}>TOTAL REMBOURSÉ</Text>
            <Text style={styles.grandTotalValue}>{money(total)}</Text>
          </View>
        </View>
        <View style={{ marginTop: 22 }}>
          <Text style={styles.sectionTitle}>TRACE DE LA DÉCISION</Text>
          <PartyRow label="Motif" value={receipt.reason} />
          <PartyRow label="Décidé le" value={formatDate(receipt.issuedAt)} />
        </View>
        <LegalFooter
          sellerName={receipt.sellerName}
          sellerAddress={receipt.sellerAddress}
          sellerVatNumber={receipt.sellerVatNumber}
          rib={contact?.rib}
          contact={contact}
          reference={`Justificatif ${receipt.number}`}
        />
      </Page>
    </Document>
  );
}
