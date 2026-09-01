import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8").replace(/\r\n/g, "\n");

describe("every REFUND transaction row can be linked to the credit note that funds it", () => {
  test("the schema carries the link both ways", () => {
    const schema = source("prisma/schema.prisma");
    expect(schema).toContain('creditNoteId String?     @unique');
    expect(schema).toContain('creditNote   CreditNote? @relation(fields: [creditNoteId], references: [id], onDelete: SetNull)');
    expect(schema).toContain("pendingRefundCreditNoteId String?");
  });

  test("pinPendingRefund persists the credit note id so an interrupted refund can still link it on retry", () => {
    const helper = source("lib/payments/pin-pending-refund.js");
    expect(helper).toContain("export function pinPendingRefund(tx, paymentId, amount, idempotencyKey, creditNoteId = null)");
    expect(helper).toContain("pendingRefundCreditNoteId: creditNoteId");
    expect(helper).toContain("pendingRefundCreditNoteId: null"); // cleared in clearPendingRefund
  });

  test("the retry cron links the credit note it was pinned with, not a fresh guess", () => {
    const retry = source("lib/payments/retry-failed-refunds.js");
    expect(retry).toContain("creditNoteId: payment.pendingRefundCreditNoteId");
  });

  // Every synchronous call site that both issues a credit note and creates
  // the REFUND Transaction row in the same operation must link the two —
  // otherwise a refund reads on the ledger with no way back to the document
  // that justifies it (the exact gap reported: "chaque transaction fallait
  // avoir une note de crédit associée").
  const directLinkSites = [
    ["actions/boutique/returns.js", 2],
    ["actions/boutique/orders.js", 2],
    ["actions/reservation/cancel-reservation.js", 1],
    ["actions/appointment/manage-appointment.js", 1],
    ["actions/workshops/manage-reservation.js", 1],
    ["actions/formations/manage-reservation.js", 1],
    ["app/api/webhooks/stripe/route.js", 2],
    ["lib/payments/reconcile-missed-refunds.js", 2],
  ];

  for (const [file, minOccurrences] of directLinkSites) {
    test(`${file} links every REFUND transaction it creates to a credit note`, () => {
      const content = source(file);
      const occurrences = (content.match(/creditNoteId(?::| =)/g) ?? []).length;
      expect(occurrences, `${file} should reference creditNoteId at least ${minOccurrences} time(s)`).toBeGreaterThanOrEqual(minOccurrences);
    });
  }

  test("the order-refund reconciliation helper hands its transaction id back to the caller", () => {
    const helper = source("lib/orders/reconcile-stripe-refund.js");
    expect(helper).toContain("transactionId,");
    expect(helper).toContain("transactionId = created.id");
  });
});

describe("the credit note PDF shows the credited amount as negative", () => {
  test("CreditNoteDocument negates HT/TVA/TTC before handing them to TotalsBlock", () => {
    const doc = source("lib/pdf/InvoiceDocument.jsx");
    const fnIdx = doc.indexOf("export function CreditNoteDocument");
    const fn = doc.slice(fnIdx, doc.indexOf("export function", fnIdx + 1));
    expect(fn).toContain("subtotalExclVat={-Number(creditNote.subtotalExclVat)}");
    expect(fn).toContain("vatAmount={-Number(creditNote.vatAmount)}");
    expect(fn).toContain("totalInclVat={-Number(creditNote.totalInclVat)}");
  });

  test("money() itself renders a negative value with a minus sign, not just abs()", () => {
    const theme = source("lib/pdf/theme.jsx");
    const fnIdx = theme.indexOf("export function money");
    const fn = theme.slice(fnIdx, theme.indexOf("\n}", fnIdx));
    expect(fn).toContain("n < 0");
  });

  test("the header names the invoice it credits instead of a generic title, and drops the status pill and the duplicate notice", () => {
    const doc = source("lib/pdf/InvoiceDocument.jsx");
    const fnIdx = doc.indexOf("export function CreditNoteDocument");
    const fn = doc.slice(fnIdx, doc.indexOf("export function", fnIdx + 1));
    expect(fn).toContain("title={`Note de crédit sur ${invoice.number}`}");
    expect(fn).not.toContain("NOTE DE CRÉDIT");
    expect(fn).not.toContain("CRÉDIT TOTAL");
    expect(fn).not.toContain("CRÉDIT PARTIEL");
    expect(fn).not.toContain("Se rapporte à la facture");
  });
});

describe("staff can manually generate a credit note for a refund that never got one automatically", () => {
  const actions = source("actions/dashboard/admin-operations.js");

  test("issueCreditNoteForTransaction is admin-gated", () => {
    const fnIdx = actions.indexOf("export async function issueCreditNoteForTransaction");
    const fn = actions.slice(fnIdx, actions.length);
    expect(fn).toContain("requireAdminOperationsAccess()");
  });

  test("it refuses a transaction already linked to a note, and one with no invoice, regardless of type", () => {
    const fnIdx = actions.indexOf("export async function issueCreditNoteForTransaction");
    const fn = actions.slice(fnIdx, actions.length);
    // Any invoiced transaction is eligible — a deposit or final payment can
    // need a manual correction just as much as a refund — so the only gates
    // left are "already linked" and "no invoice to correct against".
    expect(fn).not.toContain('transaction.transactionType !== "REFUND"');
    expect(fn).toContain("transaction.creditNoteId");
    expect(fn).toContain("!transaction.payment?.invoice");
  });

  test("the generated credit note is linked back onto the transaction in the same DB transaction", () => {
    const fnIdx = actions.indexOf("export async function issueCreditNoteForTransaction");
    const fn = actions.slice(fnIdx, actions.length);
    const txIdx = fn.indexOf("prisma.$transaction(async (tx)");
    expect(txIdx).toBeGreaterThan(-1);
    const txBody = fn.slice(txIdx, fn.indexOf("return creditNote;", txIdx) + 30 || fn.length);
    expect(fn).toContain("tx.transaction.update({ where: { id: transaction.id }, data: { creditNoteId: note.id } })");
  });

  test("the button offers to generate one for any invoiced row with no existing note", () => {
    const rowActions = source("components/dashboard/operations/InvoiceRowActions.jsx");
    // notes normalizes both the Transactions tab's singular `creditNote` and
    // the Reservations tab's `creditNotes` list to one array — eligibility
    // is "this row's own note(s), whichever shape they came in, is empty".
    expect(rowActions).toContain("const notes = creditNotes ?? (creditNote ? [creditNote] : [])");
    expect(rowActions).toContain(
      "Boolean(transaction) && transaction.hasInvoice && notes.length === 0"
    );
  });

  test("generating a credit note no longer prompts for an optional reason", () => {
    const rowActions = source("components/dashboard/operations/InvoiceRowActions.jsx");
    expect(rowActions).not.toContain("noteReason");
    expect(rowActions).not.toContain("Motif (facultatif)");
    expect(rowActions).toContain("issueCreditNoteForTransaction(transaction.id)");
  });
});
