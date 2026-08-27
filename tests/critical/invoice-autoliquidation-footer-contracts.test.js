import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const invoiceDocument = readFileSync(`${root}lib/pdf/InvoiceDocument.jsx`, "utf8");

describe("invoice reverse-charge footer", () => {
  test("shows the Belgian reverse-charge wording only on reverse-charge invoices", () => {
    expect(invoiceDocument).toContain('invoice.vatTreatment === "EU_REVERSE_CHARGE"');
    expect(invoiceDocument).toContain("Autoliquidation Art 21 § 2 du code TVA belge");
    expect(invoiceDocument).toContain("<LegalFooter");
  });
});
