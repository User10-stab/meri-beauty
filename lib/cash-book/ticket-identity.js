import { calculateVatTotals } from "@/lib/tax-policy";

// Full immutable transaction IDs avoid collisions and need no counter migration.
// Invoice association may be added later without changing the receipt identity.
export function collectionTicketFields(transaction, invoice = null, vatRate = 0) {
  if (!transaction?.id || transaction.isDeleted ||
      !["DEPOSIT", "FINAL_PAYMENT"].includes(transaction.transactionType) ||
      !(Number(transaction.amount) > 0) || !transaction.paidAt) {
    throw new Error("A ticket requires a recorded collection");
  }
  const rate = invoice?.vatRate ?? vatRate;
  const totals = calculateVatTotals(transaction.amount, rate);
  return {
    ticketNumber: `T-${transaction.id}`,
    pieceNumber: transaction.pieceNumber ?? null,
    invoiceNumber: invoice?.number ?? null,
    issuedAt: transaction.paidAt,
    subtotalExclVat: totals.totalExclVat,
    vatRate: rate,
    vatAmount: totals.vatAmount,
    totalInclVat: totals.totalInclVat,
  };
}
