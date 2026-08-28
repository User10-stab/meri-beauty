import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { REVERSE_CHARGE_NOTE, VAT_LEGAL_NOTES, resolveServiceVatPolicy } from "@/lib/tax-policy";

const root = fileURLToPath(new URL("../../", import.meta.url));
const invoiceDocument = readFileSync(`${root}lib/pdf/InvoiceDocument.jsx`, "utf8");

describe("invoice reverse-charge footer", () => {
  // The client asked for the mention on every invoice, B2C and B2B alike, and
  // intends to narrow it later (2026-08-28). Asserted explicitly so the day
  // that decision is reversed, this test is what says so out loud.
  test("prints the mention unconditionally, on invoices and credit notes alike", () => {
    // Both footers, and neither of them gated on the transaction. Matched on
    // the prop rather than on the bare expression, so the comment explaining
    // how to restore the conditional does not trip this.
    const legalNoteProps = invoiceDocument.match(/legalNote=\{[^}]*\}/g) ?? [];
    expect(legalNoteProps).toEqual(["legalNote={FOOTER_LEGAL_NOTE}", "legalNote={FOOTER_LEGAL_NOTE}"]);
    expect(invoiceDocument).toContain("<LegalFooter");
  });

  test("takes the wording from tax-policy rather than a second hardcoded copy", () => {
    // The invoice and its own credit note used to print two different
    // spellings of the same legal mention, because the PDF carried a
    // hardcoded string while the credit note read the stored taxNote.
    expect(invoiceDocument).toContain('import { REVERSE_CHARGE_NOTE } from "@/lib/tax-policy"');
    expect(invoiceDocument).not.toMatch(/=\s*"Autoliquidation/);
    expect(REVERSE_CHARGE_NOTE).toBe("Autoliquidation Art 21 § 2 du code TVA belge");
  });

  test("the stored note is normalised to the same wording", () => {
    expect(VAT_LEGAL_NOTES.FOREIGN_EU_B2B_ZERO).toBe(REVERSE_CHARGE_NOTE);
  });

  // Printing the mention everywhere must not change which sales are actually
  // zero-rated: a Belgian customer is still taxed at 21%.
  test("printing everywhere did not turn domestic sales into reverse charges", () => {
    const belgian = resolveServiceVatPolicy({
      customer: { isCompany: true, vatNumber: "BE0751854027", vatValidatedAt: new Date() },
    });
    expect(belgian.vatTreatment).toBe("DOMESTIC");
    expect(Number(belgian.vatRate)).toBe(21);
    expect(belgian.taxNote).toBeNull();
  });
});
