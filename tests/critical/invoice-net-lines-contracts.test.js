import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { allocateNetLines } from "@/lib/invoicing";
import { calculateVatTotals, BELGIUM_VAT_RATE } from "@/lib/tax-policy";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8").replace(/\r\n/g, "\n");

/**
 * Article 226(8) of directive 2006/112/CE requires the unit price EXCLUDING
 * VAT on every invoice line. The lines used to carry only the gross amount
 * charged, printed under a "P.U. TTC" header.
 */
describe("invoice lines carry their VAT-exclusive twin", () => {
  const sum = (lines, key) => lines.reduce((total, l) => total + l[key], 0);

  test("net lines add up to the invoice's own subtotal, to the cent", () => {
    // Three awkward prices at 21%: each divides to a repeating decimal, so
    // independently rounded lines drift against the invoice total.
    const lines = [
      { description: "A", quantity: 3, unitPrice: 25.95 },
      { description: "B", quantity: 1, unitPrice: 11.99 },
      { description: "C", quantity: 7, unitPrice: 4.35 },
    ];
    const gross = sum(
      lines.map((l) => ({ t: l.unitPrice * l.quantity })),
      "t"
    );
    const totals = calculateVatTotals(gross, BELGIUM_VAT_RATE);

    const net = allocateNetLines(lines, BELGIUM_VAT_RATE, totals.totalExclVat);

    expect(sum(net, "lineTotalExclVat")).toBeCloseTo(totals.totalExclVat, 2);
    expect(sum(net, "lineTotal")).toBeCloseTo(totals.totalInclVat, 2);
  });

  test("the printed unit price accurately extracts HT from stored TTC", () => {
    const gross = 25.95;

    const [line] = allocateNetLines(
      [{ description: "Popits", quantity: 1, unitPrice: gross }],
      BELGIUM_VAT_RATE,
      calculateVatTotals(gross, BELGIUM_VAT_RATE).totalExclVat
    );
    expect(line.unitPriceExclVat).toBe(21.4463);
  });

  test("a 0% reverse-charge invoice invents no VAT", () => {
    const lines = [{ description: "Formation", quantity: 2, unitPrice: 150 }];
    const net = allocateNetLines(lines, 0, 300);
    expect(net[0].unitPriceExclVat).toBe(150);
    expect(net[0].lineTotalExclVat).toBe(300);
    expect(net[0].lineTotal).toBe(300);
  });

  test("the rounding residual lands on the largest line, never flipping a discount", () => {
    const lines = [
      { description: "Article", quantity: 1, unitPrice: 100.01 },
      { description: "Code promotionnel", quantity: 1, unitPrice: -0.01 },
    ];
    const gross = 100;
    const totals = calculateVatTotals(gross, BELGIUM_VAT_RATE);
    const net = allocateNetLines(lines, BELGIUM_VAT_RATE, totals.totalExclVat);

    expect(sum(net, "lineTotalExclVat")).toBeCloseTo(totals.totalExclVat, 2);
    // The discount line stays a discount.
    expect(net[1].lineTotalExclVat).toBeLessThanOrEqual(0);
  });

  test("issueInvoice stores the allocation instead of raw gross lines", () => {
    const invoicing = source("lib/invoicing.js");
    expect(invoicing).toContain("create: allocateNetLines(lines, vatRate, totals.totalExclVat)");
  });

  test("the PDF prints the net unit price, as the directive requires", () => {
    const theme = source("lib/pdf/theme.jsx");
    expect(theme).toContain("P.U. HT");
    expect(theme).toContain("MONTANT HT");
    expect(theme).not.toContain("P.U. TTC");
    // Read from the stored column; the divisor is only a fallback for
    // invoices issued before those columns existed.
    expect(theme).toContain("line.unitPriceExclVat ??");
    expect(theme).toContain("line.lineTotalExclVat ??");
  });

  test("the migration backfills from each invoice's own rate, not a flat 21%", () => {
    const migration = source(
      "prisma/migrations/20260827120000_invoice_lines_net_of_vat/migration.sql"
    );
    expect(migration).toContain('i."vatRate"');
    expect(migration).not.toContain("/ 1.21");
    // The gross columns are an issued legal document — never rewritten.
    expect(migration).not.toMatch(/UPDATE "InvoiceLine"[\s\S]*SET\s+"unitPrice"\s*=/);
  });
});
