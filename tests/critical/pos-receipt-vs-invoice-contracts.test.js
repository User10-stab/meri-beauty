import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { pointOfSaleSaleSchema } from "@/lib/validations/point-of-sale";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8");

const baseSale = {
  customer: { fullName: "Jean Dupont", email: "jean@example.com", addressLine1: "Rue X 1", addressCity: "Bruxelles", addressPostalCode: "1000" },
  items: [{ type: "PRODUCT", variantId: "v1", quantity: 1 }],
  method: "CASH",
  attemptKey: "a".repeat(20),
  cashReceived: 10,
};

describe("requestInvoice is optional, defaults false, and only matters for a named customer", () => {
  test("absent defaults to false", () => {
    const result = pointOfSaleSaleSchema.safeParse(baseSale);
    expect(result.success).toBe(true);
    expect(result.data.requestInvoice).toBe(false);
  });

  test("can be explicitly checked", () => {
    const result = pointOfSaleSaleSchema.safeParse({ ...baseSale, requestInvoice: true });
    expect(result.success).toBe(true);
    expect(result.data.requestInvoice).toBe(true);
  });
});

// 31 Aug 2026: the invoice PDF used to be auto-e-mailed straight from the
// till for a foreign-VAT company or a private customer who checked "demander
// une facture" — bypassing the staff review that every other invoiced sale
// already gets (Belgian B2B goes over Peppol instead, chosen manually from
// Opérations). Now every named-customer sale gets the same compact receipt
// automatically; an owed invoice is still created and numbered, but only
// ever leaves the building when staff send it by hand afterward.
describe("a named customer always gets a receipt at the till; the invoice itself is never auto-e-mailed", () => {
  const posSource = source("actions/boutique/point-of-sale.js");

  test("invoice creation is gated on isCompany OR an explicit request — never on isWalkIn alone", () => {
    // A B2B customer must always get a real invoice regardless of the
    // checkbox, since they need it to deduct their own VAT — this is not
    // something the till can override.
    expect(posSource).toContain("const wantsInvoice = !isWalkIn && (customer?.isCompany || requestInvoice)");
    expect(posSource).toContain("const invoice = !wantsInvoice");
  });

  test("the invoice PDF is never rendered or e-mailed from the till", () => {
    expect(posSource).not.toContain("renderInvoicePdf");
    expect(posSource).not.toContain('import { renderInvoicePdf');
  });

  test("every named-customer sale renders and e-mails the same compact ticket-style receipt", () => {
    const branch = posSource.indexOf("const holdsInvoiceForPeppol = Boolean(result.invoice)");
    expect(branch).toBeGreaterThan(-1);
    const block = posSource.slice(branch);
    // Same renderer as the walk-in ticket — no separate template, no
    // invoice numbering touched anywhere in this branch.
    expect(block).toContain("renderTicketPdf(");
    expect(block).toContain("sendEmail(receiptEmail)");
    expect(block).not.toContain("issueInvoice(");
    expect(block).toContain(
      'documentType: !result.invoice ? "receipt" : holdsInvoiceForPeppol ? "invoice_pending_peppol" : "invoice_pending_manual_send"'
    );
  });

  test("a Belgian company's invoice is created and numbered but withheld from the auto e-mail — Peppol delivers it instead", () => {
    expect(posSource).toContain("isPeppolMandatoryCustomer");
    expect(posSource).toContain(
      "const holdsInvoiceForPeppol = Boolean(result.invoice) && isPeppolMandatoryCustomer(result.customer)"
    );

    const taxPolicy = source("lib/tax-policy.js");
    expect(taxPolicy).toContain("export function isPeppolMandatoryCustomer(customer)");
    expect(taxPolicy).toContain('getVatCountryCode(customer.vatNumber) === "BE"');
  });

  test("a non-Peppol invoice (foreign VAT, or a private customer who checked the box) is flagged for manual sending, not e-mailed here", () => {
    expect(posSource).toContain("invoice_pending_manual_send");
    expect(posSource).toContain("transmise séparément par e-mail");
  });
});

describe("the till only shows the invoice checkbox where it would actually matter", () => {
  const clientSource = source("components/dashboard/boutique/PointOfSaleClient.jsx");

  test("a company customer (or a currently-typed VAT number) forces the invoice and hides the checkbox", () => {
    expect(clientSource).toContain(
      "const willBeB2B = customer.isCompany || Boolean(customer.vatNumber.trim())"
    );
    expect(clientSource).toContain("willBeB2B ? (");
  });

  test("requestInvoice is only ever sent true for a named customer, never for a walk-in", () => {
    expect(clientSource).toContain("requestInvoice: !isWalkIn && requestInvoice");
  });

  test("selecting an existing customer carries their isCompany flag into the till form", () => {
    expect(clientSource).toContain("isCompany: Boolean(match.isCompany)");
  });

  test("a receipt-only sale is printable at the till just like a walk-in ticket", () => {
    expect(clientSource).toContain('result.data.documentType === "receipt"');
  });

  test("every documentType the server can return is handled — none fall through to a dead default", () => {
    expect(clientSource).toContain('result.data.documentType === "invoice_pending_peppol"');
    expect(clientSource).toContain('result.data.documentType === "invoice_pending_manual_send"');
  });
});
