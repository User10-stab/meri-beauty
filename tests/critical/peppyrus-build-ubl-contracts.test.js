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
