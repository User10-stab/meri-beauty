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

describe("credit-note delivery is a deliberate action from the operation detail", () => {
  const rowActions = source("components/dashboard/operations/InvoiceRowActions.jsx");
  const drawer = source("components/dashboard/operations/TransactionDetailDrawer.jsx");
  const delivery = source("components/dashboard/operations/DocumentDeliveryDialog.jsx");

  test("keeps the table to one management entry point", () => {
    expect(rowActions).toContain("Voir / gérer");
    expect(rowActions).not.toContain("sendCreditNoteByEmail");
    expect(rowActions).not.toContain("sendCreditNoteToBillit");
  });

  test("opens the same explicit delivery card for the note", () => {
    expect(drawer).toContain('kind: "CREDIT_NOTE"');
    expect(drawer).toContain("Envoyer la note de crédit");
    expect(delivery).toContain("sendCreditNoteByEmail(documentRecord.id)");
    expect(delivery).toContain("sendCreditNoteToBillit(documentRecord.id)");
    expect(delivery).toContain("Créer dans Billit / Peppol");
  });

  test("Billit handoff asks for confirmation and does not claim automatic Peppol dispatch", () => {
    expect(delivery).toContain("onClick={() => setConfirmingBillit(true)}");
    expect(delivery).toContain("L'envoi Peppol est ensuite finalisé manuellement dans Billit");
  });

  test("both the entity-grained ledger select and the appointment-transactions hydrator carry delivery timestamps", () => {
    const actions = source("actions/dashboard/admin-operations.js");
    expect(actions).toContain("creditNote: { select: { id: true, number: true, totalInclVat: true, emailSentAt: true, billitSentAt: true } }");
    // Shared by orders/workshops/formations (PAYMENT_LEDGER_SELECT).
    expect(actions).toContain("creditNotes: { select: { id: true, number: true, totalInclVat: true, emailSentAt: true, billitSentAt: true } }");
    // Appointments stay on their own, event-grained hydrator — same fields,
    // its own copy.
    const appointmentIdx = actions.indexOf("async function hydrateAppointmentTransactions");
    expect(appointmentIdx).toBeGreaterThan(-1);
    const appointmentFn = actions.slice(appointmentIdx, actions.indexOf("\n}\n", appointmentIdx));
    expect(appointmentFn).toContain("select: { id: true, number: true, totalInclVat: true, emailSentAt: true, billitSentAt: true }");
  });

  test("the invoice-status column still displays prior delivery state", () => {
    const client = source("components/dashboard/operations/AdminOperationsClient.jsx");
    expect(client).toContain("invoice.emailSentAt");
    expect(client).toContain("E-mail envoyé le");
    expect(client).toContain("Créée dans Billit — à finaliser");
  });
});
