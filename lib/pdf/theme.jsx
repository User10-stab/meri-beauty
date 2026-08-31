import { Font, Text, View, StyleSheet } from "@react-pdf/renderer";

// @react-pdf hyphenates by default, which chops legal identifiers and city
// names mid-word ("Brux-elles") on an invoice. Words wrap whole instead.
Font.registerHyphenationCallback((word) => [word]);

/**
 * Shared visual language for every PDF the shop hands a customer — invoice,
 * credit note, POS ticket. All three used to carry their own private copy of
 * the same stylesheet, which is exactly how they drifted apart; keeping the
 * tokens and the header/party/table/totals blocks here means a brand change
 * lands on all of them at once.
 *
 * Colours mirror the transactional emails (lib/email-templates.js) so a
 * customer's confirmation mail and the attached PDF read as one brand.
 *
 * Only the 14 PDF standard fonts are used: @react-pdf resolves those without
 * loading anything from disk, so rendering can never fail on a host where
 * `public/fonts` didn't make it into the deployment bundle.
 */

export const COLORS = {
  brand: "#2F3A2E", // deep green — logo / email header
  gold: "#C8A46A", // accent
  text: "#2B2B28",
  muted: "#7A7A72",
  faint: "#9C9C94",
  hairline: "#E4E2DA",
  panel: "#F7F6F2",
  credit: "#A4362F",
  creditPanel: "#FBF2F1",
  white: "#FFFFFF",
};

const SERIF = "Times-Roman";

export const styles = StyleSheet.create({
  page: {
    paddingTop: 38,
    paddingHorizontal: 42,
    paddingBottom: 96, // room for the fixed legal footer
    fontSize: 9,
    fontFamily: "Helvetica",
    color: COLORS.text,
    lineHeight: 1.4,
  },

  // ─── Header ────────────────────────────────────────────────────────────
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  // The wordmark is a fixed graphic identity — it must never be squeezed to
  // make room for a long document title (see headerTitleBlock).
  headerBrand: { flexGrow: 0, flexShrink: 0 },
  wordmark: { fontFamily: SERIF, fontSize: 19, letterSpacing: 3.4, color: COLORS.brand },
  wordmarkRule: { flexDirection: "row", alignItems: "center", justifyContent: "center", marginTop: 7 },
  wordmarkTick: { width: 18, height: 0.75, flexGrow: 0, flexShrink: 0, backgroundColor: COLORS.gold },
  wordmarkTagline: { fontSize: 6, letterSpacing: 2.6, color: COLORS.gold, marginHorizontal: 6 },
  // 31 Aug 2026: titles used to be one word ("FACTURE"), so this block had no
  // width at all and simply grew. "Note de crédit sur F-2026-000004" then
  // overran the wordmark and printed on top of it. Constraining the block
  // makes a long title wrap onto a second line instead of colliding, and the
  // left margin guarantees a visible gap even at the maximum width.
  headerTitleBlock: { flexGrow: 0, flexShrink: 1, maxWidth: 250, marginLeft: 18 },
  docTitle: { fontSize: 19, fontWeight: 700, letterSpacing: 2, lineHeight: 1.15, color: COLORS.brand, textAlign: "right" },
  // Long titles step down a size so a two-line wrap still fits the header
  // band without pushing the rule (and the whole document) down the page.
  docTitleLong: { fontSize: 13, letterSpacing: 1.2 },
  docNumber: { fontSize: 10, fontWeight: 700, textAlign: "right", marginTop: 6 },
  docMeta: { fontSize: 8, color: COLORS.muted, textAlign: "right" },
  rule: { flexDirection: "row", marginTop: 14, marginBottom: 22 },
  ruleAccent: { width: 62, height: 2, backgroundColor: COLORS.gold },
  ruleBase: { flex: 1, height: 2, backgroundColor: COLORS.brand },

  // ─── Status pill ───────────────────────────────────────────────────────
  pillRow: { flexDirection: "row", justifyContent: "flex-end", marginTop: 7 },
  pill: { paddingVertical: 3, paddingHorizontal: 7, borderRadius: 2 },
  pillText: { fontSize: 6.5, fontWeight: 700, letterSpacing: 1 },

  // ─── Sections ──────────────────────────────────────────────────────────
  sectionTitle: {
    fontSize: 8,
    fontWeight: 700,
    letterSpacing: 1.1,
    color: COLORS.brand,
    borderBottom: `0.75 solid ${COLORS.hairline}`,
    paddingBottom: 5,
    marginBottom: 9,
  },

  // ─── Parties ───────────────────────────────────────────────────────────
  parties: { flexDirection: "row", marginBottom: 20 },
  partyColumn: { flex: 1 },
  partyGutter: { width: 34 },
  partyRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 1.5 },
  partyLabel: { fontSize: 8, color: COLORS.muted, flex: 1 },
  partyValue: { fontSize: 8.5, flex: 1.7, textAlign: "right" },
  partyValueStrong: { fontSize: 8.5, fontWeight: 700, flex: 1.7, textAlign: "right" },

  // ─── Notice boxes ──────────────────────────────────────────────────────
  notice: {
    borderLeft: `2 solid ${COLORS.gold}`,
    backgroundColor: COLORS.panel,
    paddingVertical: 7,
    paddingHorizontal: 10,
    marginBottom: 18,
    fontSize: 8,
    color: COLORS.text,
  },
  creditNotice: {
    borderLeft: `2 solid ${COLORS.credit}`,
    backgroundColor: COLORS.creditPanel,
    paddingVertical: 7,
    paddingHorizontal: 10,
    marginBottom: 18,
    fontSize: 8,
    color: COLORS.credit,
  },

  // ─── Line table ────────────────────────────────────────────────────────
  tableHead: {
    flexDirection: "row",
    backgroundColor: COLORS.panel,
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  tableHeadCell: { fontSize: 7, fontWeight: 700, letterSpacing: 0.7, color: COLORS.brand },
  tableRow: {
    flexDirection: "row",
    paddingVertical: 7,
    paddingHorizontal: 8,
    borderBottom: `0.5 solid ${COLORS.hairline}`,
  },
  colIndex: { flex: 0.5, color: COLORS.faint },
  // Narrowed from 5.4 when the net columns were added: the line now carries
  // P.U. HT, MONTANT HT and MONTANT TTC, and the description has to give up
  // the room rather than let the money columns wrap.
  colDescription: { flex: 3.8, paddingRight: 8 },
  colQty: { flex: 1, textAlign: "center" },
  colUnit: { flex: 1.8, textAlign: "right" },
  // The net amount is the legally required figure, the gross is the one the
  // customer recognises from their bank — so only the gross is emphasised.
  colAmountNet: { flex: 2, textAlign: "right" },
  colAmount: { flex: 2, textAlign: "right", fontWeight: 700 },

  // ─── Bottom block ──────────────────────────────────────────────────────
  bottom: { flexDirection: "row", marginTop: 22 },
  terms: { flex: 1, paddingRight: 28 },
  termsRow: { marginBottom: 6 },
  termsLabel: { fontSize: 7.5, fontWeight: 700, color: COLORS.brand, letterSpacing: 0.4 },
  termsValue: { fontSize: 8, color: COLORS.muted },
  totals: { width: 214 },
  totalsRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3.5 },
  totalsDivider: { height: 0.5, backgroundColor: COLORS.hairline, marginVertical: 2 },
  totalsLabel: { fontSize: 8.5, color: COLORS.muted },
  totalsValue: { fontSize: 8.5 },
  grandTotal: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: COLORS.brand,
    paddingVertical: 9,
    paddingHorizontal: 11,
    marginTop: 8,
  },
  grandTotalLabel: { fontSize: 8, fontWeight: 700, letterSpacing: 0.8, color: COLORS.white },
  grandTotalValue: { fontSize: 12, fontWeight: 700, color: COLORS.white },

  // ─── Footer ────────────────────────────────────────────────────────────
  footer: { position: "absolute", bottom: 42, left: 42, right: 42 },
  footerRule: { height: 0.75, backgroundColor: COLORS.hairline, marginBottom: 8 },
  footerLegal: { fontSize: 7.5, color: COLORS.text, textAlign: "center", marginBottom: 3 },
  footerLine: { fontSize: 7, color: COLORS.faint, textAlign: "center" },
  footerReference: { fontSize: 6.5, color: COLORS.faint, textAlign: "center", marginTop: 4, letterSpacing: 0.5 },
});

/** Belgian convention: comma decimals, symbol last — "1 234,50 €". */
export function money(value) {
  const n = Number(value) || 0;
  const [whole, cents] = Math.abs(n).toFixed(2).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${n < 0 ? "-" : ""}${grouped},${cents} €`;
}

export function formatDate(date) {
  return new Date(date).toLocaleDateString("fr-BE", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    timeZone: "Europe/Brussels",
  });
}

// ─── Building blocks ─────────────────────────────────────────────────────

export function Wordmark() {
  return (
    <View style={styles.headerBrand}>
      <Text style={styles.wordmark}>MERIBEAUTY</Text>
      <View style={styles.wordmarkRule}>
        <View style={styles.wordmarkTick} />
        <Text style={styles.wordmarkTagline}>STUDIO · SHOP</Text>
        <View style={styles.wordmarkTick} />
      </View>
    </View>
  );
}

/**
 * @param {{ title: string, number: string, issuedAt: Date|string, status?: { label: string, tone?: "paid"|"credit" }|null }} props
 */
export function DocumentHeader({ title, number, issuedAt, status = null }) {
  const tone = status?.tone === "credit"
    ? { backgroundColor: COLORS.creditPanel, color: COLORS.credit }
    : { backgroundColor: COLORS.panel, color: COLORS.brand };

  return (
    <View>
      <View style={styles.header}>
        <Wordmark />
        <View style={styles.headerTitleBlock}>
          <Text style={[styles.docTitle, title.length > 14 && styles.docTitleLong]}>{title}</Text>
          <Text style={styles.docNumber}>N° {number}</Text>
          <Text style={styles.docMeta}>Émise le {formatDate(issuedAt)}</Text>
          {status && (
            <View style={styles.pillRow}>
              <View style={[styles.pill, { backgroundColor: tone.backgroundColor }]}>
                <Text style={[styles.pillText, { color: tone.color }]}>{status.label}</Text>
              </View>
            </View>
          )}
        </View>
      </View>
      <View style={styles.rule}>
        <View style={styles.ruleAccent} />
        <View style={styles.ruleBase} />
      </View>
    </View>
  );
}

export function PartyRow({ label, value, strong = false }) {
  if (!value) return null;
  return (
    <View style={styles.partyRow}>
      <Text style={styles.partyLabel}>{label}</Text>
      <Text style={strong ? styles.partyValueStrong : styles.partyValue}>{value}</Text>
    </View>
  );
}

/**
 * Seller identity, from the snapshot stored on the document itself — never
 * from live salon data, so a reprint years later still shows the legal
 * identity that was in force on the issue date. `contact` (phone/email/site)
 * is the one live part: it is presentational, not a legal mention.
 */
export function SellerBlock({ name, address, vatNumber, registrationNo, rib, contact }) {
  return (
    <View style={styles.partyColumn}>
      <Text style={styles.sectionTitle}>VENDEUR</Text>
      <PartyRow label="Entreprise" value={name} strong />
      <PartyRow label="Adresse" value={address} />
      <PartyRow label="TVA" value={vatNumber} />
      <PartyRow label="N° BCE" value={registrationNo} />
      <PartyRow label="Compte bancaire (RIB)" value={rib} />
      <PartyRow label="Téléphone" value={contact?.phone} />
      <PartyRow label="Email" value={contact?.email} />
      <PartyRow label="Site web" value={contact?.website} />
    </View>
  );
}

/** Nominative buyer block — B2B invoices lead with the legal entity. */
export function BuyerBlock({ invoice, title = "ACHETEUR" }) {
  const isB2B = invoice.customerType === "B2B" && Boolean(invoice.customerLegalName);
  return (
    <View style={styles.partyColumn}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <PartyRow label={isB2B ? "Entreprise" : "Nom et prénom"} value={isB2B ? invoice.customerLegalName : invoice.customerName} strong />
      {isB2B && <PartyRow label="À l'attention de" value={invoice.customerContactName || invoice.customerName} />}
      <PartyRow label="Adresse" value={invoice.customerAddress} />
      <PartyRow label="Email" value={invoice.customerEmail} />
      <PartyRow label="TVA" value={invoice.customerVatNumber} />
      <PartyRow label="N° BCE" value={invoice.customerRegistrationNo} />
      <PartyRow label="Réf. commande" value={invoice.purchaseOrderReference} />
    </View>
  );
}

/**
 * Prices are stored TTC per line, so the columns say TTC explicitly — the
 * taxable base per rate is given by the totals block underneath, which is
 * what the VAT code actually requires.
 */
/**
 * Article 226(8) of directive 2006/112/CE requires the unit price EXCLUDING
 * VAT on every line, so the net columns are the ones printed; the gross
 * amount actually charged is kept beside them because a retail customer
 * reads the invoice to check what left their account, and TotalsBlock's
 * "TOTAL TTC" alone does not explain a multi-line order.
 *
 * The net figures are read from the line, never divided here: issueInvoice
 * allocates them so they sum to the invoice's own subtotal to the cent. The
 * `??` fallbacks cover invoices issued before those columns existed and
 * still print a coherent document.
 */
export function LineItemsTable({ lines, vatRate = null, title = "DÉTAIL" }) {
  const divisor = vatRate == null ? null : 1 + Number(vatRate) / 100;
  const netOf = (gross) => (divisor ? Number(gross) / divisor : Number(gross));

  return (
    <View>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.tableHead} fixed>
        <Text style={[styles.tableHeadCell, styles.colIndex]}>#</Text>
        <Text style={[styles.tableHeadCell, styles.colDescription]}>DÉSIGNATION</Text>
        <Text style={[styles.tableHeadCell, styles.colQty]}>QTÉ</Text>
        <Text style={[styles.tableHeadCell, styles.colUnit]}>P.U. HT</Text>
        <Text style={[styles.tableHeadCell, styles.colAmountNet]}>MONTANT HT</Text>
        <Text style={[styles.tableHeadCell, styles.colAmount]}>MONTANT TTC</Text>
      </View>
      {lines.map((line, index) => {
        const grossTotal = line.lineTotal ?? line.unitPrice * line.quantity;
        return (
          <View style={styles.tableRow} key={line.id ?? index} wrap={false}>
            <Text style={styles.colIndex}>{index + 1}</Text>
            <Text style={styles.colDescription}>{line.description}</Text>
            <Text style={styles.colQty}>{line.quantity}</Text>
            <Text style={styles.colUnit}>{money(line.unitPriceExclVat ?? netOf(line.unitPrice))}</Text>
            <Text style={styles.colAmountNet}>{money(line.lineTotalExclVat ?? netOf(grossTotal))}</Text>
            <Text style={styles.colAmount}>{money(grossTotal)}</Text>
          </View>
        );
      })}
    </View>
  );
}

export function TermsBlock({ items }) {
  const visible = items.filter((item) => item?.value);
  if (!visible.length) return null;
  return (
    <View style={styles.terms}>
      {visible.map((item) => (
        <View style={styles.termsRow} key={item.label}>
          <Text style={styles.termsLabel}>{item.label}</Text>
          <Text style={styles.termsValue}>{item.value}</Text>
        </View>
      ))}
    </View>
  );
}

export function TotalsBlock({ subtotalExclVat, vatRate, vatAmount, totalInclVat, grandTotalLabel = "TOTAL TTC" }) {
  return (
    <View style={styles.totals}>
      <View style={styles.totalsRow}>
        <Text style={styles.totalsLabel}>Sous-total hors TVA</Text>
        <Text style={styles.totalsValue}>{money(subtotalExclVat)}</Text>
      </View>
      <View style={styles.totalsDivider} />
      <View style={styles.totalsRow}>
        <Text style={styles.totalsLabel}>TVA ({Number(vatRate)} %)</Text>
        <Text style={styles.totalsValue}>{money(vatAmount)}</Text>
      </View>
      <View style={styles.grandTotal}>
        <Text style={styles.grandTotalLabel}>{grandTotalLabel}</Text>
        <Text style={styles.grandTotalValue}>{money(totalInclVat)}</Text>
      </View>
    </View>
  );
}

/**
 * Fixed on every page: the legal VAT mention (reverse charge etc.) must be
 * readable on whichever sheet the reader is holding, and multi-page
 * documents need "page x / y" to be provably complete.
 */
export function LegalFooter({ legalNote, sellerName, sellerAddress, sellerVatNumber, rib, contact, reference }) {
  const identity = [sellerName, sellerAddress, sellerVatNumber ? `TVA ${sellerVatNumber}` : null]
    .filter(Boolean)
    .join(" — ");
  const contactLine = [contact?.email, contact?.phone, contact?.website].filter(Boolean).join(" · ");

  return (
    <View style={styles.footer} fixed>
      <View style={styles.footerRule} />
      {legalNote ? <Text style={styles.footerLegal}>{legalNote}</Text> : null}
      <Text style={styles.footerLine}>{identity}</Text>
      {rib ? <Text style={styles.footerLine}>RIB : {rib}</Text> : null}
      {contactLine ? <Text style={styles.footerLine}>{contactLine}</Text> : null}
      <Text style={styles.footerReference}>{reference}</Text>
    </View>
  );
}
