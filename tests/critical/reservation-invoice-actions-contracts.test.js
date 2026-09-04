import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8").replace(/\r\n/g, "\n");

describe("the Ateliers/Formations reservation tabs expose the B2B invoice status and delivery entry point", () => {
  const actions = source("actions/dashboard/admin-operations.js");
  const client = source("components/dashboard/operations/AdminOperationsClient.jsx");

  test("the workshops hydrator fetches the payment's id, invoice and every credit note against it, via the shared ledger select", () => {
    const fnIdx = actions.indexOf("async function hydrateWorkshops");
    const fn = actions.slice(fnIdx, actions.indexOf("\n}\n", fnIdx));
    expect(fn).toContain("payment: { select: PAYMENT_LEDGER_SELECT }");
    // PAYMENT_LEDGER_SELECT itself carries invoice + every credit note —
    // pinned in admin-operations-invoice-actions-contracts.test.js.
  });

  test("the formations hydrator fetches the payment's id, invoice and every credit note against it, via the shared ledger select", () => {
    const fnIdx = actions.indexOf("async function hydrateFormations");
    const fn = actions.slice(fnIdx, actions.indexOf("\n}\n", fnIdx));
    expect(fn).toContain("payment: { select: PAYMENT_LEDGER_SELECT }");
  });

  test("the shared ledger select carries the payment id for the operational context both reservation hydrators need", () => {
    const selectIdx = actions.indexOf("const PAYMENT_LEDGER_SELECT");
    const select = actions.slice(selectIdx, actions.indexOf("});", selectIdx));
    expect(select).toContain("id: true");
  });

  test("the unified table renders the shared facture status component for every source, including reservations", () => {
    const fnIdx = client.indexOf("function UnifiedOperationsTable(");
    const fn = client.slice(fnIdx, client.indexOf("\nfunction ", fnIdx + 1));
    expect(fn).toContain("<TableHead>Facture</TableHead>");
    expect(fn).toContain("const invoice = row.payment?.invoice ?? null;");
    expect(fn).toContain("<InvoiceStatus invoice={invoice} customerInvoiceEligible={row.customerInvoiceEligible} />");
  });

  test("a transaction IS passed on a reservation row once one exists — cancel-and-refund is reachable from every tab, not just Transactions", () => {
    // Unification's whole point: an atelier/formation row reached via its
    // own preset gets the same "Voir / gérer" -> drawer -> "Annuler et
    // rembourser" path a Transactions-tab row always had. See
    // latestTransaction() and the Part 1 cancel-and-refund fix.
    const fnIdx = client.indexOf("function latestTransaction(");
    expect(fnIdx).toBeGreaterThan(-1);
    const fn = client.slice(fnIdx, client.indexOf("\nfunction ", fnIdx + 1));
    expect(fn).toContain("row.latestTransactionId");
    expect(client).toContain("transaction={transaction ? { ...transaction, hasInvoice: Boolean(invoice) } : null}");
  });
});

describe("the compact action column retains financial safety", () => {
  const rowActions = source("components/dashboard/operations/InvoiceRowActions.jsx");

  test("uses every credit note to keep a fully credited invoice from reopening cancellation", () => {
    expect(rowActions).toContain("creditNotes = null");
    expect(rowActions).toContain("const notes = creditNotes ?? (creditNote ? [creditNote] : [])");
    expect(rowActions).toContain("const invoiceFullyCredited");
  });
});

// 1 Sep 2026 bug report: a particulier's atelier booking showed "Pas encore
// émise" for the invoice (correct — hasInvoiceableVatIdentity means a
// particulier never gets one) AND a permanently disabled ticket button
// ("aucune facture émise"), leaving the customer with proof of payment in
// neither form. The old ticket paths (sendReservationTicketsForSession's
// close-of-session batch, and the first cut of this route) all required an
// Invoice to exist, which a particulier's payment never has. Fixed by keying
// the ticket on the Payment instead, computing the figures straight from it
// when there's no Invoice to reprint.
describe("a ticket for a rendez-vous/atelier/formation payment is available whether or not it has an invoice", () => {
  const route = source("app/api/payments/[id]/ticket/route.js");

  test("the route is keyed on the Payment, not the Invoice", () => {
    expect(route).toContain("prisma.payment.findUnique");
  });

  test("computes the ticket straight from the Payment's own VAT policy when no Invoice exists", () => {
    // This is the exact fix for the particulier gap: no `if (!invoice) return`
    // short-circuit — the else branch always produces a renderable ticket.
    expect(route).toContain("resolveServiceVatPolicy({ customer })");
    expect(route).toContain("paidAmount: true");
    expect(route).toContain("calculateVatTotals(payment.paidAmount, vatRate)");
    expect(route).not.toContain("calculateVatTotals(payment.totalAmount, vatRate)");
    expect(route).not.toMatch(/if \(!payment\.invoice\)\s*{\s*return NextResponse\.json/);
  });

  test("reprints the Invoice's frozen fields verbatim when one does exist", () => {
    expect(route).toContain("if (payment.invoice) {");
    expect(route).toContain("invoiceNumber: inv.number");
  });

  test("reuses the same description helper as the close-of-session batch", () => {
    expect(route).toContain('import { describeReservationPayment } from "@/lib/cash-book/reservation-tickets"');
  });

  test("refuses a boutique-order-backed payment — that one already has its own ticket route with real line items", () => {
    expect(route).toContain("if (payment.orderId)");
  });

  test("a non-dashboard caller can only fetch their own ticket", () => {
    expect(route).toContain("canAccessDashboard(session.user.role)");
    expect(route).toContain(
      "payment.appointment?.userId ?? payment.workshopReservation?.customerId ?? payment.formationReservation?.customerId ?? null"
    );
  });

  test("describeReservationPayment is exported for reuse, not duplicated", () => {
    const lib = source("lib/cash-book/reservation-tickets.js");
    expect(lib).toContain("export function describeReservationPayment(payment)");
  });

  test("the ticket route remains independently authorized and invoice-free", () => {
    expect(route).toContain("prisma.payment.findUnique");
    expect(route).not.toMatch(/if \(!payment\.invoice\)\s*{\s*return NextResponse\.json/);
  });

  test("keeps tickets and PDFs behind one documents card instead of restoring an action strip", () => {
    const rowActions = source("components/dashboard/operations/InvoiceRowActions.jsx");
    const documents = source("components/dashboard/operations/OperationDocumentsDialog.jsx");
    expect(rowActions).toContain("Gérer les documents");
    expect(documents).toContain("/api/payments/${paymentId}/ticket");
    expect(documents).toContain("/api/invoices/${invoice.id}/pdf");
    expect(documents).toContain("/api/credit-notes/${note.id}/pdf");
  });
});
