import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8").replace(/\r\n/g, "\n");

describe("every REFUND transaction row can be linked to the credit note that funds it", () => {
  test("the schema carries the link both ways", () => {
    const schema = source("prisma/schema.prisma");
    expect(schema).toContain('creditNote   CreditNote? @relation(fields: [creditNoteId], references: [id], onDelete: SetNull)');
    expect(schema).toContain("pendingRefundCreditNoteId String?");
  });

  // One global correction settled by several refund movements is the whole
  // point of RefundOperation: a 21 € reservation paid 10,50 € online +
  // 10,50 € in cash produces ONE credit note and TWO REFUND rows. A unique
  // constraint on Transaction.creditNoteId made that impossible to record,
  // which is what forced the per-method partial notes it replaced.
  test("Transaction.creditNoteId is indexed, NOT unique — several refunds share one note", () => {
    const schema = source("prisma/schema.prisma");
    const model = schema.slice(schema.indexOf("model Transaction {"), schema.indexOf("// REFUND OPERATION"));
    expect(model).toContain("creditNoteId String?\n");
    expect(model).not.toContain("creditNoteId String?     @unique");
    expect(model).toContain("@@index([creditNoteId])");
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

describe("the isolated credit note is gone — a document is never issued without the refund behind it", () => {
  const adminOperations = source("actions/dashboard/admin-operations.js");
  const cancelAndRefund = source("actions/dashboard/cancel-and-refund.js");
  const rowActions = source("components/dashboard/operations/InvoiceRowActions.jsx");

  // The capability the handoff removes outright: "le bouton ne doit plus
  // pouvoir créer une note de crédit isolée sans annulation ni
  // remboursement". The dev-database audit found nine payments left exactly
  // there — credited on paper, every euro still in the account.
  test("issueCreditNoteForTransaction no longer exists anywhere", () => {
    expect(adminOperations).not.toContain("export async function issueCreditNoteForTransaction");
    expect(rowActions).not.toContain("issueCreditNoteForTransaction");
    expect(source("components/dashboard/operations/TransactionDetailDrawer.jsx")).not.toContain(
      "issueCreditNoteForTransaction",
    );
  });

  test("the row action is keyed on the payment and opens the cancel-and-refund dialog", () => {
    expect(rowActions).toContain("CancelAndRefundDialog");
    // Keyed on paymentId, not on the invoice: a B2C sale has no invoice and
    // must still be refundable.
    expect(rowActions).toContain("const canCancelAndRefund = Boolean(paymentId)");
    expect(rowActions).toContain('transaction?.transactionType !== "DEPOSIT"');
  });

  test("the dialog states every consequence before the admin commits", () => {
    const dialog = source("components/dashboard/operations/CancelAndRefundDialog.jsx");
    expect(dialog).toContain("Annuler et générer la note de crédit");
    for (const label of [
      "Élément concerné",
      "Statut actuel",
      "Montant total crédité",
      "Places libérées",
      "À rembourser dans Stripe (manuellement)",
      "À rendre en main propre",
    ]) {
      expect(dialog, `dialog must state "${label}"`).toContain(label);
    }
    // And that nothing has been refunded yet, nor the customer told.
    expect(dialog).toContain("Cette action ne rembourse rien");
    // Fragment avoids the apostrophe, which is &apos; in the JSX source.
    expect(dialog).toContain("une fois tout confirmé");
  });

  test("the surviving document action refuses unless the money already went back", () => {
    const fnIdx = cancelAndRefund.indexOf("export async function issueMissingRefundDocument");
    expect(fnIdx).toBeGreaterThan(-1);
    const fn = cancelAndRefund.slice(fnIdx);
    expect(fn).toContain('transaction.transactionType !== "REFUND"');
    expect(fn).toContain('throw new Error("NOT_A_REFUND")');
    expect(fn).toContain('throw new Error("ALREADY_DOCUMENTED")');
    // Never credits more than the refund actually returned, and never more
    // than the invoice has left to credit.
    expect(fn).toContain("Math.min(Number(transaction.amount), state.remainingCreditable ?? 0)");
  });

  test("it locks the invoice so two refund rows cannot each issue a note", () => {
    const fn = cancelAndRefund.slice(cancelAndRefund.indexOf("export async function issueMissingRefundDocument"));
    expect(fn).toContain('FROM "Invoice" WHERE id = ');
    expect(fn).toContain("FOR UPDATE");
  });
});
