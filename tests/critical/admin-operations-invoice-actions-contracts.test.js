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

    // peppyrusSentAt lets the row show whether this invoice was already
    // transmitted via Peppyrus; customerType/customerVatNumber let it
    // disable the Peppyrus button up front for B2C or non-Belgian invoices
    // instead of failing only after the click.
    const invoiceSelectIdx = select.indexOf("invoice: {");
    const invoiceSelect = select.slice(invoiceSelectIdx, select.indexOf("},", invoiceSelectIdx));
    for (const field of ["id: true", "number: true", "totalInclVat: true", "emailSentAt: true", "peppyrusSentAt: true", "customerType: true", "customerVatNumber: true", "creditNotes:"]) {
      expect(invoiceSelect, `invoice select is missing "${field}"`).toContain(field);
    }

    // Appointments stay event-grained (see hydrateAppointmentTransactions) —
    // a refund row there still links to exactly one credit note
    // (Transaction.creditNoteId), never to "whichever ones exist on the
    // invoice".
    expect(actions).toContain("creditNote: { select: { id: true, number: true, totalInclVat: true, emailSentAt: true, peppyrusSentAt: true } }");

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
    // formation, appointment or transfer history) — one occurrence per customer-bearing
    // relation: hydrateOrders' user, hydrateWorkshops' customer,
    // hydrateFormations' customer, hydrateAppointmentTransactions'
    // appointment.user, plus hydrateTransfers' current reservation customer
    // for BOTH a workshop and a formation transfer (it now hydrates either).
    const vatNumberOccurrences = actions.split("vatNumber: true").length - 1;
    expect(vatNumberOccurrences).toBe(6);
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

  test("the Peppyrus button really transmits over the live Peppol network — POST /message, not a staging order", () => {
    // Intentionally the OPPOSITE invariant from the old Billit contract:
    // Billit's /v1/orders was a staging step staff finished by hand inside
    // Billit's own dashboard; Peppyrus's POST /message IS the delivery, so
    // this action must actually call it, with no separate "finalize" step.
    const send = source("actions/invoices/send-invoice-peppyrus.js");
    expect(send).toContain('"use server"');
    expect(send).toContain("isAdminRole(session.user.role)");
    expect(send).toContain("sendPeppyrusMessage(");
    expect(send).toContain("buildInvoiceUbl(");

    const peppyrus = source("lib/peppyrus.js");
    expect(peppyrus).toContain('"/message"');
    expect(peppyrus).toContain("X-Api-Key");
    expect(peppyrus).toContain("PEPPYRUS_API_KEY");
  });

  test("a successful Peppyrus send records when it happened and is audited", () => {
    const send = source("actions/invoices/send-invoice-peppyrus.js");
    expect(send).toContain("peppyrusMessageId:");
    expect(send).toContain("peppyrusSentAt: new Date()");
    expect(send).toContain("AUDIT_ACTIONS.INVOICE_SENT_TO_PEPPYRUS");
    expect(source("lib/audit-log.js")).toContain('INVOICE_SENT_TO_PEPPYRUS: "invoice.sent_to_peppyrus"');
  });

  test("Operations shows the confirmed e-mail send separately from the Peppyrus send", () => {
    const client = source("components/dashboard/operations/AdminOperationsClient.jsx");
    expect(client).toContain("invoice.emailSentAt");
    expect(client).toContain("E-mail envoyé le");
    expect(client).toContain("Envoyée via Peppol le");
    expect(client).toContain("Non envoyée");
  });

  test("a settled deposit is hidden from the overview but remains available in payment details", () => {
    const actions = source("actions/dashboard/admin-operations.js");
    const client = source("components/dashboard/operations/AdminOperationsClient.jsx");
    expect(client).toContain("Total notes de crédit :");
    expect(client).toContain("reste à créditer");
    expect(client).not.toContain("Acompte lié au solde ci-dessous");
    expect(client).not.toContain("Solde de l’acompte ci-dessus");

    // Entity-grained rows retain their whole payment history. Appointments
    // do too, so the ledger never hides an actual collection.
    expect(actions).toContain('JOIN "Appointment" a ON a.id = p."appointmentId"');
    expect(actions).toContain('transactions: { orderBy: { paidAt: "asc" }');
  });

  test("a B2B invoice is delivered through one channel checklist plus a confirm step", () => {
    const send = source("actions/invoices/send-invoice-email.js");
    expect(send).not.toContain("isBelgianVatNumber");
    expect(send).not.toContain("pas par e-mail direct");

    const delivery = source("components/dashboard/operations/DocumentDeliveryDialog.jsx");
    // Both channels are checkboxes on one card — either, both, or (until a box
    // is ticked) neither — not two mutually-exclusive action buttons.
    expect(delivery).toContain("Envoyer par e-mail");
    expect(delivery).toContain("Envoyer via Peppol (Peppyrus)");
    expect(delivery).toContain("useState(false)"); // emailChecked / peppyrusChecked default off
    // The e-mail send now carries the dialog's recipient choices; the
    // Peppyrus call is unchanged.
    expect(delivery).toContain("sendInvoiceByEmail(documentRecord.id, opts)");
    expect(delivery).toContain("sendInvoiceToPeppyrus(documentRecord.id)");
    // Nothing fires straight from a channel checkbox — a shared confirm step does.
    expect(delivery).toContain("setConfirming(true)");
    expect(delivery).toContain("onClick={deliver}");
  });

  test("Peppyrus is refused for a B2C invoice or a non-Belgian VAT number, both client-side and server-side", () => {
    const send = source("actions/invoices/send-invoice-peppyrus.js");
    // The server check is the one that actually matters — nothing client-side
    // can be trusted to gate a real send.
    expect(send).toContain('if (invoice.customerType !== "B2B")');
    expect(send).toContain("isBelgianVatNumber(invoice.customerVatNumber)");

    const peppyrus = source("lib/peppyrus.js");
    expect(peppyrus).toContain("export function isBelgianVatNumber(vatNumber)");

    // The button mirrors the exact same rule (same helper, not a
    // hand-rolled second regex that could silently drift from the server's).
    const delivery = source("components/dashboard/operations/DocumentDeliveryDialog.jsx");
    expect(delivery).toContain('import { isBelgianVatNumber } from "@/lib/peppyrus"');
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
