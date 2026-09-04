import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8").replace(/\r\n/g, "\n");

describe("the operations ledger can act on an invoice, not just list it", () => {
  test("the shared payment ledger select carries the invoice the actions need", () => {
    const actions = source("actions/dashboard/admin-operations.js");
    // Unification moved the per-tab invoice/credit-note select into one
    // PAYMENT_LEDGER_SELECT, reused by every entity-grained hydrator
    // (orders/workshops/formations) — one place to keep it correct instead
    // of four copies that could drift.
    const selectIdx = actions.indexOf("const PAYMENT_LEDGER_SELECT");
    expect(selectIdx).toBeGreaterThan(-1);
    const select = actions.slice(selectIdx, actions.indexOf("});", selectIdx));

    // billitSentAt lets the row show whether this invoice was already handed
    // to Billit; customerType/customerVatNumber let it disable the Billit
    // button up front for B2C or non-Belgian invoices instead of failing
    // only after the click.
    const invoiceSelectIdx = select.indexOf("invoice: {");
    const invoiceSelect = select.slice(invoiceSelectIdx, select.indexOf("},", invoiceSelectIdx));
    for (const field of ["id: true", "number: true", "totalInclVat: true", "emailSentAt: true", "billitSentAt: true", "customerType: true", "customerVatNumber: true", "creditNotes:"]) {
      expect(invoiceSelect, `invoice select is missing "${field}"`).toContain(field);
    }

    // Appointments stay event-grained (see hydrateAppointmentTransactions) —
    // a refund row there still links to exactly one credit note
    // (Transaction.creditNoteId), never to "whichever ones exist on the
    // invoice".
    expect(actions).toContain("creditNote: { select: { id: true, number: true, totalInclVat: true, emailSentAt: true, billitSentAt: true } }");

    // Without the customer on the row there is nothing to show next to the
    // amount, and the e-mail button has no visible recipient. isCompany/
    // vatValidatedAt drive customerInvoiceEligible, not display — see the
    // "Aucune (particulier)" vs "Pas encore émise" contract below.
    expect(actions).toContain(
      "user: { select: { fullName: true, email: true, vatNumber: true, isCompany: true, vatValidatedAt: true } }"
    );
  });

  test("every entity's customer relation carries its VAT number, not just the order's", () => {
    const actions = source("actions/dashboard/admin-operations.js");
    // The Opérations ledger needs to tell a private individual apart from a
    // VAT-registered company across every source (boutique order, atelier,
    // formation, or appointment) — one occurrence per customer-bearing
    // relation: hydrateOrders' user, hydrateWorkshops' customer,
    // hydrateFormations' customer, and hydrateAppointmentTransactions'
    // appointment.user.
    const vatNumberOccurrences = actions.split("vatNumber: true").length - 1;
    expect(vatNumberOccurrences).toBe(4);
  });

  test("the ledger shows the invoice's frozen VAT number, falling back to the customer's current one", () => {
    const client = source("components/dashboard/operations/AdminOperationsClient.jsx");
    expect(client).toContain("invoice?.customerVatNumber ?? customer?.vatNumber ?? null");
    expect(client).toContain("N° TVA");
  });

  test("the detail action is admin-gated like the list it belongs to", () => {
    const actions = source("actions/dashboard/admin-operations.js");
    const fnIdx = actions.indexOf("export async function getTransactionDetail");
    expect(fnIdx).toBeGreaterThan(-1);
    const fn = actions.slice(fnIdx);
    expect(fn).toContain("requireAdminOperationsAccess()");
    // Decimals must not cross into the client tree unconverted.
    expect(fn).toContain("serializeDecimalFields({");
    // Drives the drawer's "Annuler et rembourser" gate — computed via the
    // canonical helper rather than re-derived ad hoc on the client.
    expect(fn).toContain("summarizeRefundState({");
    expect(fn).toContain("refundState:");
  });

  test("sending an invoice is admin-only and never lets the caller pick the recipient", () => {
    const send = source("actions/invoices/send-invoice-email.js");
    expect(send).toContain('"use server"');
    expect(send).toContain("isAdminRole(session.user.role)");
    // The address comes from the issued document, not from an argument — a
    // legally issued invoice names one buyer and must reach only that buyer.
    expect(send).toContain("invoice.customerEmail");
    expect(send).not.toMatch(/export async function sendInvoiceByEmail\([^)]*recipient/);
    expect(send).not.toMatch(/export async function sendInvoiceByEmail\([^)]*to\b/);
  });

  test("a failed provider send is reported as a failure, not a silent success", () => {
    const send = source("actions/invoices/send-invoice-email.js");
    // sendEmail resolves { success: false } instead of throwing.
    expect(send).toContain("result.success === false");
  });

  test("a re-send is written to the audit log", () => {
    const send = source("actions/invoices/send-invoice-email.js");
    expect(send).toContain("data: { emailSentAt: new Date() }");
    expect(send).toContain("AUDIT_ACTIONS.INVOICE_EMAILED");
    expect(source("lib/audit-log.js")).toContain('INVOICE_EMAILED: "invoice.emailed"');
  });

  test("the Billit button creates the order in Billit only — never auto-dispatches Peppol/e-mail", () => {
    const send = source("actions/invoices/send-invoice-billit.js");
    expect(send).toContain('"use server"');
    expect(send).toContain("isAdminRole(session.user.role)");
    // POST /v1/orders only — see lib/billit.js's own docstring for why a
    // separate Billit "send" endpoint is deliberately never called here.
    expect(send).toContain("createBillitOrder(payload)");
    expect(send).not.toMatch(/commands\/send|sendInvoiceViaPeppol/);

    const billit = source("lib/billit.js");
    expect(billit).toContain("/v1/orders");
    expect(billit).not.toContain("/commands/send");
    expect(billit).toContain("process.env.BILLIT_PARTY_ID");
    expect(billit).toContain("PartyID: partyId");
  });

  test("a successful Billit send records when it happened and is audited", () => {
    const send = source("actions/invoices/send-invoice-billit.js");
    expect(send).toContain("billitOrderId:");
    expect(send).toContain("billitSentAt: new Date()");
    expect(send).toContain("AUDIT_ACTIONS.INVOICE_SENT_TO_BILLIT");
    expect(source("lib/audit-log.js")).toContain('INVOICE_SENT_TO_BILLIT: "invoice.sent_to_billit"');
  });

  test("Operations shows the confirmed e-mail send separately from the Billit handoff", () => {
    const client = source("components/dashboard/operations/AdminOperationsClient.jsx");
    expect(client).toContain("invoice.emailSentAt");
    expect(client).toContain("E-mail envoyé le");
    expect(client).toContain("Créée dans Billit — à finaliser");
    expect(client).toContain("Non envoyée");
  });

  test("a settled deposit is hidden from the overview but remains available in payment details", () => {
    const actions = source("actions/dashboard/admin-operations.js");
    const client = source("components/dashboard/operations/AdminOperationsClient.jsx");
    expect(client).toContain("Total notes de crédit :");
    expect(client).toContain("reste à créditer");
    expect(client).not.toContain("Acompte lié au solde ci-dessous");
    expect(client).not.toContain("Solde de l’acompte ci-dessus");

    // Orders/workshops/formations are entity-grained now — a deposit and its
    // later balance are just two nested Transaction rows on one entity row,
    // never two competing top-level rows, so no suppression is needed for
    // them at all. Appointments alone stay event-grained (their own
    // dashboard flows, not part of this unification) and keep the exact
    // suppress-the-deposit-once-a-balance-exists rule, now expressed as SQL.
    expect(actions).toContain("t.\"transactionType\" = 'DEPOSIT'");
    expect(actions).toContain("t2.\"transactionType\" = 'FINAL_PAYMENT'");
    expect(actions).toContain('transactions: { orderBy: { paidAt: "asc" }');
  });

  test("a B2B invoice is delivered through one explicit choice card", () => {
    const send = source("actions/invoices/send-invoice-email.js");
    expect(send).not.toContain("isBelgianVatNumber");
    expect(send).not.toContain("pas par e-mail direct");

    const delivery = source("components/dashboard/operations/DocumentDeliveryDialog.jsx");
    expect(delivery).toContain("Envoyer par e-mail");
    expect(delivery).toContain("Créer dans Billit / Peppol");
    expect(delivery).toContain("sendInvoiceByEmail(documentRecord.id)");
    expect(delivery).toContain("sendInvoiceToBillit(documentRecord.id)");
  });

  test("Billit is refused for a B2C invoice or a non-Belgian VAT number, both client-side and server-side", () => {
    const send = source("actions/invoices/send-invoice-billit.js");
    // The server check is the one that actually matters — nothing client-side
    // can be trusted to gate a real send.
    expect(send).toContain('if (invoice.customerType !== "B2B")');
    expect(send).toContain("isBelgianVatNumber(invoice.customerVatNumber)");

    const billit = source("lib/billit.js");
    expect(billit).toContain("export function isBelgianVatNumber(vatNumber)");

    // The button mirrors the exact same rule (same helper, not a
    // hand-rolled second regex that could silently drift from the server's).
    const delivery = source("components/dashboard/operations/DocumentDeliveryDialog.jsx");
    expect(delivery).toContain('import { isBelgianVatNumber } from "@/lib/billit"');
    expect(delivery).toContain('invoice?.customerType === "B2B"');
    expect(delivery).toContain("isBelgianVatNumber(invoice?.customerVatNumber)");
  });

  test("the delivery button is beside the B2B invoice status, while the row stays compact", () => {
    const client = source("components/dashboard/operations/AdminOperationsClient.jsx");
    const actions = source("components/dashboard/operations/InvoiceRowActions.jsx");
    expect(client).toContain('invoice.customerType === "B2B"');
    expect(client).toContain('"Envoyer la facture"');
    expect(client).toContain("<DocumentDeliveryDialog");
    expect(actions).toContain("Voir / gérer");
    expect(actions).not.toContain("sendInvoiceByEmail");
  });

  test("the detail drawer is reachable from every row that has a real payment event", () => {
    const client = source("components/dashboard/operations/AdminOperationsClient.jsx");
    expect(client).toContain("<TransactionDetailDrawer");
    // Unified across every preset now — onOpenDetail only exists once a row
    // has a transaction to open (see latestTransaction), not just on what
    // used to be the Transactions-only tab.
    expect(client).toContain("onOpenDetail={transaction ? () => onOpenDetail(transaction.id) : undefined}");
    expect(client).toContain("<InvoiceRowActions");
  });
});
