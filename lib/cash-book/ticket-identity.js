import { calculateVatTotals, roundMoney } from "@/lib/tax-policy";

const COLLECTION_TYPES = ["DEPOSIT", "FINAL_PAYMENT"];

const isLiveCollection = (t) =>
  Boolean(
    t?.id &&
      !t.isDeleted &&
      COLLECTION_TYPES.includes(t.transactionType) &&
      Number(t.amount) > 0 &&
      t.paidAt,
  );

// ticketNumber is the caller's Payment.ticketNumber — the global gapless
// sequence allocated once, at settlement, by lib/tickets/allocate-ticket-number.js.
// It may legitimately be null: every sale settled BEFORE that system shipped
// (15/09/2026) has none until scripts/backfill-ticket-numbers.mjs runs, and
// those receipts still have to be reprintable. "Not settled yet" is a
// different question, answered by Payment.status where the caller can see it
// — see buildPaymentTicket. Using a missing number as the proxy for it made
// every historical reprint throw, which surfaced as a bare HTTP 500.
export function collectionTicketFields(transaction, ticketNumber, invoice = null, vatRate = 0) {
  if (!isLiveCollection(transaction)) {
    throw new Error("A ticket requires a recorded collection");
  }
  const rate = invoice?.vatRate ?? vatRate;
  const totals = calculateVatTotals(transaction.amount, rate);
  return {
    ticketNumber: ticketNumber ?? null,
    pieceNumber: transaction.pieceNumber ?? null,
    invoiceNumber: invoice?.number ?? null,
    issuedAt: transaction.paidAt,
    subtotalExclVat: totals.totalExclVat,
    vatRate: rate,
    vatAmount: totals.vatAmount,
    totalInclVat: totals.totalInclVat,
  };
}

/**
 * One receipt for a whole reservation payment, however many legs it was
 * collected in (an online acompte, then the balance at the counter). Identity
 * is the Payment, not any single Transaction; the amount is the SUM of the legs
 * (the full prestation price), VAT recomputed from that VAT-inclusive sum.
 * `payments[]` is the per-leg breakdown the ticket prints between the line
 * items and the totals.
 *
 * Same contract as collectionTicketFields: throws (never returns null) on an
 * empty/invalid set, so callers keep it inside their post-commit .catch().
 */
export function consolidatedTicketFields(paymentId, ticketNumber, collections, invoice = null, vatRate = 0) {
  const legs = (Array.isArray(collections) ? collections : [])
    .filter(isLiveCollection)
    .sort(
      (a, b) =>
        new Date(a.paidAt) - new Date(b.paidAt) || String(a.id).localeCompare(String(b.id)),
    );
  if (!paymentId || legs.length === 0) {
    throw new Error("A consolidated ticket requires at least one recorded collection");
  }

  const rate = invoice?.vatRate ?? vatRate;
  const grossTotal = roundMoney(legs.reduce((sum, t) => sum + Number(t.amount), 0));
  const totals = calculateVatTotals(grossTotal, rate);

  return {
    ticketNumber: ticketNumber ?? null,
    // The legal cash-book sequence when there is one: the piece number of the
    // last CASH leg. Online acompte legs (method ONLINE) carry none.
    pieceNumber: legs.filter((t) => t.pieceNumber).at(-1)?.pieceNumber ?? null,
    invoiceNumber: invoice?.number ?? null,
    // The sale is only "settled" at the last movement.
    issuedAt: legs.at(-1).paidAt,
    subtotalExclVat: totals.totalExclVat,
    vatRate: rate,
    vatAmount: totals.vatAmount,
    totalInclVat: totals.totalInclVat,
    payments: legs.map((t) => ({
      label: t.transactionType === "DEPOSIT" ? "Acompte" : "Solde",
      issuedAt: t.paidAt,
      amount: roundMoney(Number(t.amount)),
      pieceNumber: t.pieceNumber ?? null,
    })),
  };
}
