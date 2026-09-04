import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8").replace(/\r\n/g, "\n");

// 1 Sep 2026: an already-issued credit note could only ever be downloaded —
// there was no way to (re-)send it to the customer, by e-mail or, for a
// Belgian B2B invoice, via Billit/Peppol. The invoice it corrects already had
// both; the correcting document did not.
describe("an issued credit note can be e-mailed to the customer named on its invoice", () => {
  const send = source("actions/invoices/send-credit-note-email.js");

  test("is admin-only and takes no recipient argument — the address always comes from the invoice", () => {
    expect(send).toContain('"use server"');
    expect(send).toContain("isAdminRole(session.user.role)");
    expect(send).toContain("invoice.customerEmail");
    expect(send).not.toMatch(/export async function sendCreditNoteByEmail\([^)]*recipient/);
    expect(send).not.toMatch(/export async function sendCreditNoteByEmail\([^)]*,\s*to\b/);
  });

  test("CreditNote carries no customer snapshot of its own — the recipient is read through its invoice", () => {
    expect(send).toContain("include: { invoice: { include: { lines: true } } }");
    expect(send).toContain("const invoice = creditNote.invoice;");
  });

  test("allows e-mail for a Belgian B2B credit note as an alternative to Billit/Peppol", () => {
    expect(send).not.toContain("isBelgianVatNumber");
    expect(send).not.toContain("pas par e-mail direct");
  });

  test("a failed provider send is reported as a failure, not a silent success", () => {
    expect(send).toContain("result.success === false");
  });

  test("a send is written to the audit log", () => {
    expect(send).toContain("data: { emailSentAt: new Date() }");
    expect(send).toContain("AUDIT_ACTIONS.CREDIT_NOTE_EMAILED");
    expect(source("lib/audit-log.js")).toContain('CREDIT_NOTE_EMAILED: "credit_note.emailed"');
  });
});

describe("a Belgian B2B credit note can be sent to Billit for Peppol delivery, like its invoice", () => {
  const send = source("actions/invoices/send-credit-note-billit.js");

  test("creates the order only — never auto-dispatches Peppol/e-mail", () => {
    expect(send).toContain('"use server"');
    expect(send).toContain("isAdminRole(session.user.role)");
    expect(send).toContain("createBillitOrder(payload)");
    expect(send).not.toMatch(/commands\/send|sendInvoiceViaPeppol/);
  });

  test("refuses a B2C credit note or a non-Belgian VAT number, mirroring the invoice guard", () => {
    expect(send).toContain('if (invoice.customerType !== "B2B")');
    expect(send).toContain("isBelgianVatNumber(invoice.customerVatNumber)");
  });

  test("is typed as a CreditNote order in Billit, not another Invoice", () => {
    expect(send).toContain('OrderType: "CreditNote"');
    expect(send).toContain("RelatedInvoiceNumber: invoice.number");
  });

  test("looks up the buyer's Peppol identifier through the same payment chain as the invoice flow", () => {
    expect(send).toContain("prisma.billingProfile.findUnique");
    expect(send).toContain("parsePeppolIdentifier(peppolRaw)");
  });

  test("a successful send records when it happened and is audited", () => {
    expect(send).toContain("billitOrderId:");
    expect(send).toContain("billitSentAt: new Date()");
    expect(send).toContain("AUDIT_ACTIONS.CREDIT_NOTE_SENT_TO_BILLIT");
    expect(source("lib/audit-log.js")).toContain('CREDIT_NOTE_SENT_TO_BILLIT: "credit_note.sent_to_billit"');
  });

  test("CreditNote has its own billitOrderId/billitSentAt columns, mirroring Invoice's", () => {
    const schema = source("prisma/schema.prisma");
    const modelIdx = schema.indexOf("model CreditNote {");
    const model = schema.slice(modelIdx, schema.indexOf("\n}", modelIdx));
    expect(model).toContain("billitOrderId String?");
    expect(model).toContain("billitSentAt  DateTime?");
  });
});

describe("the operations row exposes both send actions per credit note, gated the same way the invoice's own buttons are", () => {
  const rowActions = source("components/dashboard/operations/InvoiceRowActions.jsx");

  test("renders a CreditNoteActions strip per note instead of a bare download link", () => {
    expect(rowActions).toContain("function CreditNoteActions({ note, invoice })");
    expect(rowActions).toContain("<CreditNoteActions key={note.id} note={note} invoice={invoice} />");
  });

  test("reads the Belgian-B2B gate off the row's invoice — CreditNote has no customerType/vatNumber of its own", () => {
    const fnIdx = rowActions.indexOf("function CreditNoteActions(");
    const fn = rowActions.slice(fnIdx, rowActions.indexOf("\nfunction ", fnIdx + 1) === -1 ? undefined : rowActions.indexOf("\nfunction ", fnIdx + 1));
    expect(fn).toContain('invoice.customerType === "B2B" && isBelgianVatNumber(invoice.customerVatNumber)');
    expect(fn).toContain("sendCreditNoteByEmail(note.id)");
    expect(fn).toContain("sendCreditNoteToBillit(note.id)");
    const emailIdx = fn.indexOf('aria-label="Envoyer la note de crédit par e-mail"');
    const emailButton = fn.slice(fn.lastIndexOf("<button", emailIdx), fn.indexOf("</button>", emailIdx));
    expect(emailButton).toContain("disabled={sending}");
    expect(emailButton).not.toContain("emailBlockedReason");
  });

  test("the Billit send opens a re-verify confirmation before calling the real action, same as the invoice's own button", () => {
    const fnIdx = rowActions.indexOf("function CreditNoteActions(");
    const fn = rowActions.slice(fnIdx, rowActions.indexOf("\nfunction ", fnIdx + 1));
    expect(fn).toContain("onClick={() => setConfirmingBillit(true)}");
    expect(fn).toContain("<ConfirmDialog");
    expect(fn).toContain("onConfirm={handleSendBillit}");
  });

  test("both reservation-tab and transaction-tab credit note selects carry delivery timestamps", () => {
    const actions = source("actions/dashboard/admin-operations.js");
    expect(actions).toContain("creditNote: { select: { id: true, number: true, totalInclVat: true, emailSentAt: true, billitSentAt: true } }");
    const occurrences = actions.split("creditNotes: { select: { id: true, number: true, totalInclVat: true, emailSentAt: true, billitSentAt: true } }").length - 1;
    expect(occurrences).toBe(2);
  });

  test("Operations displays e-mail delivery separately from the Billit handoff", () => {
    expect(rowActions).toContain("note.emailSentAt");
    expect(rowActions).toContain("e-mail envoyé le");
    expect(rowActions).toContain("créée dans Billit — à finaliser");
    expect(rowActions).toContain("non envoyée");
  });
});
