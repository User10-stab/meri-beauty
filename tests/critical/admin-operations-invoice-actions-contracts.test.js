import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8").replace(/\r\n/g, "\n");

describe("the operations ledger can act on an invoice, not just list it", () => {
  test("the transactions query carries the invoice and the customer the actions need", () => {
    const actions = source("actions/dashboard/admin-operations.js");
    const transactionsBlockIdx = actions.indexOf("if (tab === \"transactions\")");
    const transactionsBlock = actions.slice(transactionsBlockIdx, actions.indexOf("} else if (tab === \"orders\")", transactionsBlockIdx));

    // The row's own credit note — not every note ever issued against the
    // invoice — lets a refund row link to the exact document that justifies
    // it (see Transaction.creditNoteId).
    expect(transactionsBlock).toContain("creditNote: { select: { id: true, number: true, totalInclVat: true, billitSentAt: true } }");

    // billitSentAt lets the row show whether this invoice was already handed
    // to Billit; customerType/customerVatNumber let it disable the Billit
    // button up front for B2C or non-Belgian invoices instead of failing
    // only after the click.
    const invoiceSelectIdx = transactionsBlock.indexOf("invoice: {");
    const invoiceSelect = transactionsBlock.slice(invoiceSelectIdx, transactionsBlock.indexOf("},", invoiceSelectIdx));
    for (const field of ["id: true", "number: true", "billitSentAt: true", "customerType: true", "customerVatNumber: true"]) {
      expect(invoiceSelect, `invoice select is missing "${field}"`).toContain(field);
    }
    // Without the customer on the row there is nothing to show next to the
    // amount, and the e-mail button has no visible recipient. isCompany/
    // vatValidatedAt drive customerInvoiceEligible, not display — see the
    // "Aucune (particulier)" vs "Pas encore émise" contract below.
    expect(actions).toContain(
      "order: { select: { id: true, orderNumber: true, user: { select: { fullName: true, email: true, vatNumber: true, isCompany: true, vatValidatedAt: true } } } }"
    );
  });

  test("every transaction customer relation carries its VAT number, not just the order's", () => {
    const actions = source("actions/dashboard/admin-operations.js");
    const transactionsBlockIdx = actions.indexOf("if (tab === \"transactions\")");
    const transactionsBlock = actions.slice(transactionsBlockIdx, actions.indexOf("} else if (tab === \"orders\")", transactionsBlockIdx));
    // The Opérations ledger needs to tell a private individual apart from a
    // VAT-registered company across every source a transaction can come
    // from — a walk-in POS sale, an atelier, a formation, or an appointment —
    // not just boutique orders.
    // One occurrence per customer-bearing relation on the row: order.user,
    // workshopReservation.customer, formationReservation.customer, and
    // appointment.user.
    const vatNumberOccurrences = transactionsBlock.split("vatNumber: true").length - 1;
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
    expect(fn).toContain("serializeDecimalFields(transaction)");
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
  });

  test("a successful Billit send records when it happened and is audited", () => {
    const send = source("actions/invoices/send-invoice-billit.js");
    expect(send).toContain("billitOrderId:");
    expect(send).toContain("billitSentAt: new Date()");
    expect(send).toContain("AUDIT_ACTIONS.INVOICE_SENT_TO_BILLIT");
    expect(source("lib/audit-log.js")).toContain('INVOICE_SENT_TO_BILLIT: "invoice.sent_to_billit"');
  });

  test("the Billit button opens a re-verify confirmation before calling the real action", () => {
    const actions = source("components/dashboard/operations/InvoiceRowActions.jsx");
    const billitIdx = actions.indexOf('aria-label="Envoyer via Billit"');
    expect(billitIdx, "the Billit button was not found").toBeGreaterThan(-1);

    const billitButton = actions.slice(actions.lastIndexOf("<button", billitIdx), actions.indexOf("</button>", billitIdx));
    // A Peppol send can't be recalled, so the click opens a confirmation
    // first — handleSendBillit (the real action) only fires from there.
    expect(billitButton).toContain("onClick={() => setConfirmingBillit(true)}");
    // Disabled while sending, when there is no invoice, or when the invoice
    // is blocked (B2C / non-Belgian VAT) — never unconditionally.
    expect(billitButton).toContain("disabled={!invoice || Boolean(billitBlockedReason) || sendingBillit}");

    expect(actions).toContain("<ConfirmDialog");
    expect(actions).toContain("onConfirm={handleSendBillit}");
  });

  test("a Belgian B2B invoice can never be e-mailed directly — Peppol/Billit is the only path", () => {
    // The server refusal is the one that actually matters — nothing
    // client-side can be trusted to gate a real send.
    const send = source("actions/invoices/send-invoice-email.js");
    expect(send).toContain('import { isBelgianVatNumber } from "@/lib/billit"');
    expect(send).toContain('invoice.customerType === "B2B" && isBelgianVatNumber(invoice.customerVatNumber)');

    // The button mirrors the exact same rule and stays disabled rather than
    // failing only after the click.
    const actions = source("components/dashboard/operations/InvoiceRowActions.jsx");
    expect(actions).toContain(
      'const isBelgianB2B = Boolean(invoice) && invoice.customerType === "B2B" && isBelgianVatNumber(invoice.customerVatNumber)'
    );
    const emailIdx = actions.indexOf('aria-label="Envoyer la facture par e-mail"');
    const emailButton = actions.slice(actions.lastIndexOf("<button", emailIdx), actions.indexOf("</button>", emailIdx));
    expect(emailButton).toContain("disabled={!invoice || sending || Boolean(emailBlockedReason)}");
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
    const actions = source("components/dashboard/operations/InvoiceRowActions.jsx");
    expect(actions).toContain('import { isBelgianVatNumber } from "@/lib/billit"');
    expect(actions).toContain('invoice.customerType !== "B2B"');
    expect(actions).toContain("isBelgianVatNumber(invoice.customerVatNumber)");
  });

  test("row actions degrade to disabled — never hidden — when no invoice exists", () => {
    const actions = source("components/dashboard/operations/InvoiceRowActions.jsx");
    expect(actions).toContain("const noInvoiceReason = invoice ? null :");
    expect(actions).toContain("disabled={!invoice || sending || Boolean(emailBlockedReason)}");
  });

  test("the download link points at the existing authorised PDF route", () => {
    const actions = source("components/dashboard/operations/InvoiceRowActions.jsx");
    // That route already enforces dashboard-role / owner access; the button
    // must not reach for some new unguarded path.
    expect(actions).toContain("href={`/api/invoices/${invoice.id}/pdf`}");
  });

  test("the detail drawer is reachable from the transactions table", () => {
    const client = source("components/dashboard/operations/AdminOperationsClient.jsx");
    expect(client).toContain("<TransactionDetailDrawer");
    expect(client).toContain("onOpenDetail={() => onOpenDetail(row.id)}");
    expect(client).toContain("<InvoiceRowActions");
  });
});
