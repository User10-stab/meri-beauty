import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { creditNoteLines, isFullCredit } from "@/lib/credit-notes/credit-note-lines";
import { buildCreditNoteUbl } from "@/lib/peppyrus/build-ubl";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8").replace(/\r\n/g, "\n");

// F-2026-000009 as issued in prod (Julie Schoemans, 4 products, 59,70 €).
const F9 = {
  number: "F-2026-000009",
  issuedAt: new Date("2026-09-11T13:27:40Z"),
  purchaseOrderReference: null,
  customerVatNumber: "BE0542845058",
  customerLegalName: "Schoemans, Julie",
  customerName: "Julie Schoemans",
  customerRegistrationNo: null,
  customerAddress: "Bloemenlaan 32, 1702 Dilbeek, Belgique",
  vatTreatment: "DOMESTIC",
  vatRate: 21,
  subtotalExclVat: 49.34,
  vatAmount: 10.36,
  totalInclVat: 59.7,
  lines: [
    { id: "l1", description: "Top Coat - Naked — Standard", quantity: 1, unitPrice: 17.9, lineTotal: 17.9, unitPriceExclVat: 14.7934, lineTotalExclVat: 14.8 },
    { id: "l2", description: "Finition - Lustra Top — Standard", quantity: 1, unitPrice: 12.95, lineTotal: 12.95, unitPriceExclVat: 10.7025, lineTotalExclVat: 10.7 },
    { id: "l3", description: "Base - Power Base — Standard", quantity: 1, unitPrice: 13.95, lineTotal: 13.95, unitPriceExclVat: 11.5289, lineTotalExclVat: 11.53 },
    { id: "l4", description: "The Cuticule Ritual - Cire à cuticules — Standard", quantity: 1, unitPrice: 14.9, lineTotal: 14.9, unitPriceExclVat: 12.314, lineTotalExclVat: 12.31 },
  ],
};

const NC1 = {
  number: "NC2026-000001",
  issuedAt: new Date("2026-09-16T12:00:00Z"),
  reason: "Erreur de prix",
  subtotalExclVat: 49.34,
  vatRate: 21,
  vatAmount: 10.36,
  totalInclVat: 59.7,
};

const SALON = {
  vatNumber: "BE0751854027",
  legalName: "Meri Beauty",
  companyRegistrationNo: "0751.854.027",
  addressLine1: "Rue Bonaventure 113",
  addressLine2: null,
  postalCode: "1090",
  city: "Jette",
  countryCode: "BE",
};

describe("a credit note names what it credits", () => {
  it("a full credit carries every product/service of the invoice, as invoiced", () => {
    expect(isFullCredit(NC1, F9)).toBe(true);
    const lines = creditNoteLines(NC1, F9);
    expect(lines.map((l) => l.description)).toEqual(F9.lines.map((l) => l.description));
    expect(lines.map((l) => l.lineTotal)).toEqual([17.9, 12.95, 13.95, 14.9]);
    // The HT lines add up to the credit note's own HT, to the cent.
    const sumHt = Math.round(lines.reduce((s, l) => s + l.lineTotalExclVat, 0) * 100) / 100;
    expect(sumHt).toBe(49.34);
  });

  it("pre-migration invoice lines (net columns stored as 0) still get a real HT figure", () => {
    const legacy = { ...F9, lines: F9.lines.map((l) => ({ ...l, unitPriceExclVat: 0, lineTotalExclVat: 0 })) };
    const [first] = creditNoteLines(NC1, legacy);
    expect(first.lineTotalExclVat).toBeCloseTo(14.79, 2);
  });

  it("a partial credit is one line naming the invoice and what it covered, never a guessed product", () => {
    const partial = { ...NC1, subtotalExclVat: 12.31, vatAmount: 2.59, totalInclVat: 14.9 };
    const lines = creditNoteLines(partial, F9);
    expect(lines).toHaveLength(1);
    expect(lines[0].description).toContain("Crédit partiel sur la facture F-2026-000009");
    expect(lines[0].description).toContain("Top Coat - Naked");
    expect(lines[0]).toMatchObject({ quantity: 1, lineTotal: 14.9, lineTotalExclVat: 12.31 });
  });
});

describe("the Peppol credit note carries the same lines", () => {
  it("each product is its own CreditNoteLine, and the totals still validate", () => {
    const xml = buildCreditNoteUbl({ creditNote: NC1, invoice: F9, salon: SALON, buyerParticipantId: "9925:0542845058" });
    expect(xml).toContain("<CreditNote");
    for (const line of F9.lines) expect(xml).toContain(line.description);
    expect((xml.match(/<cac:CreditNoteLine>/g) || []).length).toBe(4);
    expect(xml).toContain("F-2026-000009"); // billing reference to the corrected invoice
  });

  it("falls back to one line when a legacy invoice's lines don't add up to the credited HT", () => {
    const skewed = { ...F9, lines: [{ ...F9.lines[0], lineTotalExclVat: 99 }, ...F9.lines.slice(1)] };
    const xml = buildCreditNoteUbl({ creditNote: NC1, invoice: skewed, salon: SALON, buyerParticipantId: "9925:0542845058" });
    expect((xml.match(/<cac:CreditNoteLine>/g) || []).length).toBe(1);
    expect(xml).toContain("Note de crédit relative à la facture F-2026-000009");
  });
});

describe("the PDF and the Peppol preview use the same lines", () => {
  it("CreditNoteDocument prints the credited lines, negated like its totals", () => {
    const doc = source("lib/pdf/InvoiceDocument.jsx");
    const fn = doc.slice(doc.indexOf("export function CreditNoteDocument"));
    expect(fn).toContain('title="DÉTAIL CRÉDITÉ"');
    expect(fn).toContain("lines={creditNoteLines(creditNote, invoice).map((line) => ({");
    expect(fn).toContain("lineTotal: -line.lineTotal,");
    expect(fn.indexOf("<LineItemsTable")).toBeLessThan(fn.indexOf("<TotalsBlock"));
  });

  it("the Peppol preview lists the same lines as the XML it previews", () => {
    expect(source("actions/invoices/preview-peppyrus.js")).toContain("const lines = creditNoteLines(creditNote, invoice).map((line) => ({");
  });
});
