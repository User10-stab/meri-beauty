import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8").replace(/\r\n/g, "\n");

// 1 Sep 2026: the Ateliers/Formations reservation tabs on /dashboard/operations
// listed every booking but offered no way to reach the facture/ticket/note de
// crédit that goes with it — only the Transactions tab had that. Staff could
// not, for instance, resend a formation's invoice or reprint its ticket
// without hunting down the matching transaction row by amount/date.
describe("the Ateliers/Formations reservation tabs expose facture/ticket/note de crédit, like Transactions already does", () => {
  const actions = source("actions/dashboard/admin-operations.js");
  const client = source("components/dashboard/operations/AdminOperationsClient.jsx");

  test("the workshops query fetches the payment's id, invoice and every credit note against it", () => {
    const blockIdx = actions.indexOf('tab === "workshops"');
    const block = actions.slice(blockIdx, actions.indexOf('} else {', blockIdx));
    expect(block).toContain("invoice: {");
    expect(block).toContain("creditNotes: { select: { id: true, number: true, totalInclVat: true, billitSentAt: true } }");
  });

  test("the formations query fetches the payment's id, invoice and every credit note against it", () => {
    const blockIdx = actions.indexOf('} else {', actions.indexOf('tab === "workshops"'));
    const block = actions.slice(blockIdx);
    expect(block).toContain("invoice: {");
    expect(block).toContain("creditNotes: { select: { id: true, number: true, totalInclVat: true, billitSentAt: true } }");
  });

  test("both reservation queries carry the payment id — the ticket action is keyed on it, not the invoice", () => {
    const workshopsIdx = actions.indexOf('tab === "workshops"');
    const workshopsBlock = actions.slice(workshopsIdx, actions.indexOf('} else {', workshopsIdx));
    const formationsBlock = actions.slice(actions.indexOf('} else {', workshopsIdx));
    for (const block of [workshopsBlock, formationsBlock]) {
      const paymentIdx = block.indexOf("payment: {");
      const paymentSelect = block.slice(paymentIdx, block.indexOf("},", paymentIdx));
      expect(paymentSelect).toContain("id: true");
    }
  });

  test("the Reservations table renders a Facture column with row actions keyed on the payment", () => {
    const fnIdx = client.indexOf("function Reservations(");
    const fn = client.slice(fnIdx, client.indexOf("\nfunction ", fnIdx + 1));
    expect(fn).toContain("<TableHead>Facture</TableHead>");
    expect(fn).toContain("const invoice = row.payment?.invoice ?? null;");
    expect(fn).toContain(
      "<InvoiceRowActions invoice={invoice} creditNotes={invoice?.creditNotes ?? []} paymentId={row.payment?.id ?? null} />"
    );
  });

  test("no transaction is passed on a reservation row — credit-note generation stays a Transactions-tab-only action", () => {
    const fnIdx = client.indexOf("function Reservations(");
    const fn = client.slice(fnIdx, client.indexOf("\nfunction ", fnIdx + 1));
    expect(fn).not.toContain("transaction={");
  });
});

// A reservation row has no single Transaction to key off (its Payment can
// carry a deposit and a balance, each independently refundable), so it can
// legitimately have more than one credit note — unlike a Transactions-tab
// row, which always has at most one.
describe("InvoiceRowActions renders every credit note on a row, not just one", () => {
  const rowActions = source("components/dashboard/operations/InvoiceRowActions.jsx");

  test("accepts a creditNotes list alongside the legacy singular creditNote prop", () => {
    expect(rowActions).toContain("creditNotes = null");
    expect(rowActions).toContain("const notes = creditNotes ?? (creditNote ? [creditNote] : [])");
  });

  test("maps over the list to render one download link per note", () => {
    expect(rowActions).toContain("{notes.map((note) => (");
    expect(rowActions).toContain("href={`/api/credit-notes/${note.id}/pdf`}");
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
    expect(route).toContain("calculateVatTotals(payment.totalAmount, vatRate)");
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

  test("the row actions key the ticket link on the payment, independent of whether an invoice exists", () => {
    const rowActions = source("components/dashboard/operations/InvoiceRowActions.jsx");
    expect(rowActions).toContain("paymentId = null");
    expect(rowActions).toContain("href={`/api/payments/${paymentId}/ticket`}");
    // The button must not be gated on `invoice` — that's exactly the bug.
    const ticketBlockIdx = rowActions.indexOf("orderId ? (");
    const ticketBlock = rowActions.slice(ticketBlockIdx, rowActions.indexOf("Aucun ticket disponible", ticketBlockIdx));
    expect(ticketBlock).not.toContain(": invoice ?");
  });
});
