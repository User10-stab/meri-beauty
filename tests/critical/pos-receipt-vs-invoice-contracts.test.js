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

describe("a named private (B2C) customer gets a receipt by default, a company customer always gets an invoice", () => {
  const posSource = source("actions/boutique/point-of-sale.js");

  test("invoice creation is gated on isCompany OR an explicit request — never on isWalkIn alone", () => {
    // A B2B customer must always get a real invoice regardless of the
    // checkbox, since they need it to deduct their own VAT — this is not
    // something the till can override.
    expect(posSource).toContain("const wantsInvoice = !isWalkIn && (customer?.isCompany || requestInvoice)");
    expect(posSource).toContain("const invoice = !wantsInvoice");
  });

  test("a receipt-only sale (no invoice) still renders and e-mails a compact ticket-style document", () => {
    const receiptBranch = posSource.indexOf("if (!result.invoice || holdsInvoiceForPeppol) {");
    expect(receiptBranch).toBeGreaterThan(-1);
    const nextBranch = posSource.indexOf("const invoicePdf = await renderInvoicePdf", receiptBranch);
    expect(nextBranch).toBeGreaterThan(receiptBranch);
    const block = posSource.slice(receiptBranch, nextBranch);
    // Same renderer as the walk-in ticket — no separate template, no
    // invoice numbering touched anywhere in this branch.
    expect(block).toContain("renderTicketPdf(");
    expect(block).toContain("sendEmail(receiptEmail)");
    expect(block).not.toContain("issueInvoice(");
    expect(block).toContain('documentType: holdsInvoiceForPeppol ? "invoice_pending_peppol" : "receipt"');
  });

  test("the invoice branch is still reachable and labelled distinctly", () => {
    const invoiceReturnIdx = posSource.indexOf('documentType: "invoice"');
    expect(invoiceReturnIdx).toBeGreaterThan(-1);
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
});
