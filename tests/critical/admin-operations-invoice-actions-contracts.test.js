import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8").replace(/\r\n/g, "\n");

describe("the operations ledger can act on an invoice, not just list it", () => {
  test("the transactions query carries the invoice and the customer the actions need", () => {
    const actions = source("actions/dashboard/admin-operations.js");
    // billitSentAt lets the row show whether this invoice was already handed
    // to Billit, without a second round trip.
    expect(actions).toContain("invoice: { select: { id: true, number: true, billitSentAt: true } }");
    // Without the customer on the row there is nothing to show next to the
    // amount, and the e-mail button has no visible recipient.
    expect(actions).toContain("order: { select: { id: true, orderNumber: true, user: { select: { fullName: true, email: true } } } }");
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

  test("the Billit button is wired to the real action, not left disabled", () => {
    const actions = source("components/dashboard/operations/InvoiceRowActions.jsx");
    const billitIdx = actions.indexOf('aria-label="Envoyer via Billit"');
    expect(billitIdx, "the Billit button was not found").toBeGreaterThan(-1);

    const billitButton = actions.slice(actions.lastIndexOf("<button", billitIdx), actions.indexOf("</button>", billitIdx));
    expect(billitButton).toContain("onClick={handleSendBillit}");
    // Still disabled while sending or when there is no invoice to send —
    // never unconditionally.
    expect(billitButton).toContain("disabled={!invoice || sendingBillit}");
  });

  test("row actions degrade to disabled — never hidden — when no invoice exists", () => {
    const actions = source("components/dashboard/operations/InvoiceRowActions.jsx");
    expect(actions).toContain("const noInvoiceReason = invoice ? null :");
    expect(actions).toContain("disabled={!invoice || sending}");
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
