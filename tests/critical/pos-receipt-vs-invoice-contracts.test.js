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

describe("POS invoices are only for VIES-valid VAT customers", () => {
  test("the requestInvoice checkbox contract is gone from validation", () => {
    const result = pointOfSaleSaleSchema.safeParse(baseSale);
    expect(result.success).toBe(true);
    expect(result.data).not.toHaveProperty("requestInvoice");
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

  test("invoice creation is gated on a reusable VIES identity — never on isCompany or a checkbox", () => {
    expect(posSource).toContain("const shouldCreateInvoice = !isWalkIn && hasInvoiceableVatIdentity(customer)");
    expect(posSource).toContain("const invoice = !shouldCreateInvoice");
    expect(posSource).not.toContain("requestInvoice");
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

  test("a non-Peppol invoice is flagged for manual sending, not e-mailed here", () => {
    expect(posSource).toContain("invoice_pending_manual_send");
    expect(posSource).toContain("transmise séparément par e-mail");
  });

  test("a POS Stripe QR payment also sends the ticket, not the invoice PDF, and is VIES-gated like every other channel", () => {
    const fulfillment = source("lib/orders/fulfill-order-payment.js");
    // `!isPointOfSale ||` used to make this always true for a plain online
    // order too, bypassing the VIES gate entirely — fixed 2026-09-01.
    expect(fulfillment).toContain("const shouldCreateInvoice = hasInvoiceableVatIdentity(invoiceCustomerUser)");
    expect(fulfillment).toContain("Votre ticket est joint à cet e-mail");
    expect(fulfillment).toContain("[fulfillOrderPayment] POS ticket email failed");
  });
});

describe("the till mirrors the VIES-only invoice rule", () => {
  const clientSource = source("components/dashboard/boutique/counter/CounterCart.jsx");
  // The VAT/invoice-status copy itself renders from CounterBuyerForm now —
  // shared with the walk-in service composer and, later, a counter booking
  // composer — while CounterCart (the retail till, formerly PointOfSaleClient)
  // keeps the state and the derived booleans it's fed.
  const buyerFormSource = source("components/dashboard/boutique/counter/CounterBuyerForm.jsx");

  test("a saved reusable VIES proof is carried into the till and does not ask for another check", () => {
    expect(clientSource).toContain("vatInvoiceReady: Boolean(match.vatInvoiceReady)");
    expect(buyerFormSource).toContain('customer.vatInvoiceReady ? "Validée" : "Vérifier"');
    expect(buyerFormSource).toContain("TVA déjà validée via VIES");
  });

  test("there is no invoice checkbox for a particular customer", () => {
    expect(buyerFormSource).toContain("Client particulier — aucune facture ne sera générée");
    expect(clientSource).not.toContain("Demander une facture");
    expect(clientSource).not.toContain("requestInvoice");
    expect(buyerFormSource).not.toContain("Demander une facture");
    expect(buyerFormSource).not.toContain("requestInvoice");
  });

  test("a VIES VAT customer is told the invoice is created but sent manually", () => {
    expect(clientSource).toContain("const willHaveVatInvoice = customer.vatInvoiceReady || Boolean(customer.vatNumber.trim())");
    expect(buyerFormSource).toContain("puis envoyée manuellement depuis Opérations");
  });

  test("a receipt-only sale is printable at the till just like a walk-in ticket", () => {
    expect(clientSource).toContain('result.data.documentType === "receipt"');
  });

  test("every documentType the server can return is handled — none fall through to a dead default", () => {
    expect(clientSource).toContain('result.data.documentType === "invoice_pending_peppol"');
    expect(clientSource).toContain('result.data.documentType === "invoice_pending_manual_send"');
  });
});

// 3 Sep 2026, confirmed policy: "No automatic send invoicing no matter what
// the transaction type — we only send tickets automatically." The till
// above and the boutique order path already worked this way; the atelier,
// formation and rendez-vous fulfilment paths still attached facture-<n>.pdf
// to the confirmation e-mail. The invoice is still issued and numbered —
// Belgian VAT requires it — only its delivery moved to Opérations.
describe("no fulfilment path auto-attaches an invoice PDF — tickets only, everywhere", () => {
  const FULFILMENT_PATHS = [
    "actions/boutique/point-of-sale.js",
    "lib/orders/fulfill-order-payment.js",
    "lib/workshops/fulfill-workshop-reservation-payment.js",
    "lib/formations/fulfill-formation-reservation-payment.js",
    "app/api/webhooks/stripe/route.js",
  ];

  test.each(FULFILMENT_PATHS)("%s renders no invoice PDF and attaches no facture-*.pdf", (file) => {
    const content = source(file);
    expect(content, `${file} must not render an invoice PDF`).not.toContain("renderInvoicePdf");
    expect(content, `${file} must not attach a facture-*.pdf`).not.toContain("facture-");
  });

  // The order path predates this change and already used its own hand-rolled
  // Belgian check rather than the shared helper — that is pre-existing and
  // out of scope here. The three paths this change touched must all reuse
  // the one helper so the wording can never silently drift between them.
  test.each([
    "actions/boutique/point-of-sale.js",
    "lib/workshops/fulfill-workshop-reservation-payment.js",
    "lib/formations/fulfill-formation-reservation-payment.js",
    "app/api/webhooks/stripe/route.js",
  ])("%s tells the customer the invoice follows separately, using the shared Peppol rule", (file) => {
    const content = source(file);
    expect(content).toContain("isPeppolMandatoryCustomer");
    expect(content).toContain("pendingInvoiceNote");
    expect(content).toContain("transmise séparément");
  });

  test("the ticket/QR attachment survives on every reservation fulfilment path", () => {
    expect(source("lib/workshops/fulfill-workshop-reservation-payment.js")).toContain(
      "qrPngAttachment(checkInCode, `billet-atelier-${checkInCode}.png`)"
    );
    expect(source("lib/formations/fulfill-formation-reservation-payment.js")).toContain(
      "qrPngAttachment(checkInCode, `billet-formation-${checkInCode}.png`)"
    );
    expect(source("app/api/webhooks/stripe/route.js")).toContain("...(ticket.attachment ? [ticket.attachment] : [])");
  });
});
