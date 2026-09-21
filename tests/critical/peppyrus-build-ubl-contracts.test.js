import { describe, it, expect } from "vitest";
import { buildInvoiceUbl, buildCreditNoteUbl } from "@/lib/peppyrus/build-ubl";

const salon = {
  vatNumber: "BE0823758741",
  legalName: "Merri Beauty SRL",
  companyRegistrationNo: "0823758741",
  addressLine1: "Rue Test 1",
  addressLine2: null,
  postalCode: "1000",
  city: "Bruxelles",
  countryCode: "BE",
};

function baseInvoice(overrides = {}) {
  return {
    number: "2026-000123",
    issuedAt: new Date("2026-09-01"),
    dueDate: null,
    purchaseOrderReference: null,
    customerVatNumber: "BE0999999999",
    customerLegalName: "Client Test SRL",
    customerName: "Client Test",
    customerRegistrationNo: "0999999999",
    customerAddress: "Rue Client 2, 1050 Ixelles",
    taxCountryCode: "BE",
    vatTreatment: "DOMESTIC",
    vatRate: 21,
    subtotalExclVat: 100,
    vatAmount: 21,
    totalInclVat: 121,
    lines: [
      { description: "Prestation test", quantity: 1, unitPrice: 121, lineTotal: 121, unitPriceExclVat: 0, lineTotalExclVat: 0 },
    ],
    ...overrides,
  };
}

describe("lib/peppyrus/build-ubl", () => {
  it("builds an invoice XML without throwing, with correct totals in the XML", () => {
    const invoice = baseInvoice();
    const xml = buildInvoiceUbl({ invoice, salon, buyerParticipantId: "9925:0999999999" });
    expect(xml).toContain("<Invoice");
    expect(xml).toContain("2026-000123");
    expect(xml).toContain("121");
    expect(xml).toContain("9925");
  });

  it("derives net price from gross when unitPriceExclVat/lineTotalExclVat are 0 (pre-migration rows)", () => {
    const invoice = baseInvoice();
    const xml = buildInvoiceUbl({ invoice, salon, buyerParticipantId: "9925:0999999999" });
    // gross 121 at 21% VAT -> net 100.00, not 0.00
    expect(xml).not.toMatch(/<cbc:PriceAmount[^>]*>0(\.0+)?<\/cbc:PriceAmount>/);
  });

  // PaymentTerms carries its own cbc:Note (BT-20); only the document-level
  // one (BT-22, at most one — PEPPOL-EN16931-R002) is the admin's comment.
  const documentNotes = (xml) =>
    xml.replace(/<cac:PaymentTerms>[\s\S]*?<\/cac:PaymentTerms>/g, "").match(/<cbc:Note>[\s\S]*?<\/cbc:Note>/g) ?? [];

  it("sends a manual invoice's comment as the single document-level cbc:Note, XML-escaped", () => {
    const xml = buildInvoiceUbl({
      invoice: baseInvoice({ notes: "  Prestation du 18/09 <sur site> & déplacement inclus  " }),
      salon,
      buyerParticipantId: "9925:0999999999",
    });
    const notes = documentNotes(xml);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain("Prestation du 18/09 &lt;sur site&gt; &amp; déplacement inclus");
  });

  it("emits no document-level cbc:Note for an invoice without comment", () => {
    const xml = buildInvoiceUbl({ invoice: baseInvoice(), salon, buyerParticipantId: "9925:0999999999" });
    expect(documentNotes(xml)).toHaveLength(0);
  });

  it("an invoice is always issued settled: nothing prepaid, the whole total payable, 'acquittée'", () => {
    const xml = buildInvoiceUbl({
      invoice: baseInvoice({ source: "WORKSHOP", payment: { status: "PARTIALLY_PAID", paidAmount: "50.00" } }),
      salon,
      buyerParticipantId: "9925:0999999999",
    });
    expect(xml).toMatch(/<cbc:PayableAmount currencyID="EUR">121(\.00?)?<\/cbc:PayableAmount>/);
  });

  it("throws if the app's own stored totals disagree with the computed line totals", () => {
    const invoice = baseInvoice({ totalInclVat: 999 });
    expect(() => buildInvoiceUbl({ invoice, salon, buyerParticipantId: "9925:0999999999" })).toThrow(/Incohérence/);
  });

  it("builds a credit note XML without throwing", () => {
    const invoice = baseInvoice();
    const creditNote = {
      number: "NC2026-000001",
      issuedAt: new Date("2026-09-02"),
      reason: "Erreur de facturation",
      subtotalExclVat: 100,
      vatRate: 21,
      vatAmount: 21,
      totalInclVat: 121,
    };
    const xml = buildCreditNoteUbl({ creditNote, invoice, salon, buyerParticipantId: "9925:0999999999" });
    expect(xml).toContain("<CreditNote");
    expect(xml).toContain("NC2026-000001");
  });

  it("maps EU_REVERSE_CHARGE to categoryCode AE with the exemption note", () => {
    const invoice = baseInvoice({
      vatTreatment: "EU_REVERSE_CHARGE",
      customerVatNumber: "NL9876543210",
      customerRegistrationNo: "9876543210",
      taxCountryCode: "NL",
      vatRate: 0,
      subtotalExclVat: 100,
      vatAmount: 0,
      totalInclVat: 100,
      lines: [{ description: "Prestation test", quantity: 1, unitPrice: 100, lineTotal: 100, unitPriceExclVat: 100, lineTotalExclVat: 100 }],
    });
    const xml = buildInvoiceUbl({ invoice, salon, buyerParticipantId: "9944:9876543210" });
    expect(xml).toContain("AE");
    expect(xml).toContain("Autoliquidation");
  });

  it("throws for an out-of-scope VAT treatment (EXPORT)", () => {
    const invoice = baseInvoice({ vatTreatment: "EXPORT" });
    expect(() => buildInvoiceUbl({ invoice, salon, buyerParticipantId: null })).toThrow(/non pris en charge/);
  });
});
