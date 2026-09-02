import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8").replace(/\r\n/g, "\n");

// 1 Sep 2026 bug report: a particulier's Opérations row showed "Pas encore
// émise" for its invoice — which reads as "pending, will arrive" — when in
// fact a particulier never gets one at all (hasInvoiceableVatIdentity is
// permanently false for them, invoice or no invoice, settled or not). The
// label needs to tell "genuinely pending" apart from "will never happen".
describe("the Facture column tells a genuinely pending invoice apart from one that will never be issued", () => {
  const client = source("components/dashboard/operations/AdminOperationsClient.jsx");
  const actions = source("actions/dashboard/admin-operations.js");

  test("a shared InvoiceStatus component renders the invoice number, or one of two distinct empty states", () => {
    const fnIdx = client.indexOf("function InvoiceStatus(");
    expect(fnIdx).toBeGreaterThan(-1);
    const fn = client.slice(fnIdx, client.indexOf("\nfunction ", fnIdx + 1));
    expect(fn).toContain("if (invoice) {");
    expect(fn).toContain("if (customerInvoiceEligible) return");
    expect(fn).toContain("Pas encore émise");
    expect(fn).toContain("Aucune (particulier)");
    expect(fn).toContain("Total notes de crédit :");
    expect(fn).toContain("reste à créditer");
  });

  test("both the Transactions and Reservations tables render it instead of a bare invoice-or-fallback ternary", () => {
    const occurrences = client.split("<InvoiceStatus invoice={invoice} customerInvoiceEligible={row.customerInvoiceEligible} />").length - 1;
    expect(occurrences).toBe(2);
  });

  test("eligibility is computed server-side with the exact same rule invoicing itself uses, not re-derived in the client", () => {
    expect(actions).toContain('import { hasInvoiceableVatIdentity } from "@/lib/tax-policy"');
    // Once per tab that has a Facture column: transactions, workshops, formations.
    const occurrences = actions.split("hasInvoiceableVatIdentity(").length - 1;
    expect(occurrences).toBe(3);
  });

  test("the transactions tab resolves the same polymorphic customer the row already displays, not a re-derived one", () => {
    expect(actions).toContain("function resolveTransactionCustomer(payment)");
    expect(actions).toContain("customerInvoiceEligible: hasInvoiceableVatIdentity(resolveTransactionCustomer(row.payment))");
  });

  test("the reservation tabs key eligibility off the reservation's own customer relation", () => {
    const occurrences = actions.split("customerInvoiceEligible: hasInvoiceableVatIdentity(row.customer)").length - 1;
    expect(occurrences).toBe(2);
  });

  test("every customer select feeding eligibility carries isCompany and vatValidatedAt, not just vatNumber", () => {
    // hasReusableVatValidation (which hasInvoiceableVatIdentity relies on)
    // reads customer.isCompany and customer.vatValidatedAt — a select
    // missing either would make eligibility silently always false.
    for (const field of ["isCompany: true, vatValidatedAt: true"]) {
      const occurrences = actions.split(field).length - 1;
      // 4 transactions-tab customer relations + workshops + formations = 6.
      expect(occurrences, `"${field}" should appear once per customer-bearing select`).toBe(6);
    }
  });
});
