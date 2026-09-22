/**
 * What is still owed, in the shape the Factures table draws it.
 *
 * Manual sales, counter transfers and staff rent all wait for the same thing —
 * money on the account — so the page lists them in the table that already
 * shows the issued invoices, with one « Accepter » tick, instead of a panel
 * each above it.
 *
 * Nothing is ever refused here (user's call, 2026-09-21): an unpaid row simply
 * waits for its échéance and then reads as late. There is no rejected state,
 * and no column records one.
 */

const ORIGIN_LABELS = {
  MANUAL_SALE: "Vente sur facture",
  TRANSFER: "Virement comptoir",
  RENT: "Loyer staff",
  LEGACY_INVOICE: "Loyer staff",
};

function manualSaleRow(sale) {
  return {
    key: `sale-${sale.orderId}`,
    kind: "MANUAL_SALE",
    label: `Vente n°${sale.orderNumber}`,
    // SettleManualInvoiceDialog reads the sale straight off this row.
    orderId: sale.orderId,
    orderNumber: sale.orderNumber,
    origin: ORIGIN_LABELS.MANUAL_SALE,
    invoiceNumber: sale.invoiceNumber ?? null,
    createdAt: sale.createdAt ?? null,
    dueDate: sale.paymentDueDate ?? null,
    customerName: sale.customerLegalName || sale.customerName || "",
    customerEmail: sale.customerEmail ?? null,
    customerVatNumber: sale.customerVatNumber ?? null,
    summary: sale.summary ?? "",
    totalAmount: sale.totalAmount ?? null,
    paidAmount: sale.paidAmount ?? null,
    remainingAmount: sale.remainingAmount ?? 0,
    awaitedTransferAmount: sale.awaitedTransferAmount ?? null,
    accept: { kind: "MANUAL_SALE", orderId: sale.orderId },
    // Only a manual sale can be settled another way (cash, card, an acompte):
    // the tick records the whole balance as a transfer, the dialog does the rest.
    settleOrderId: sale.orderId,
  };
}

function transferRow(transfer) {
  return {
    key: `transfer-${transfer.paymentId}`,
    kind: "TRANSFER",
    label: transfer.reference ?? "Virement attendu",
    origin: ORIGIN_LABELS.TRANSFER,
    invoiceNumber: null,
    createdAt: transfer.createdAt ?? null,
    // A counter transfer carries no échéance: it was announced at the till.
    dueDate: null,
    customerName: transfer.customerName ?? "",
    customerEmail: transfer.customerEmail ?? null,
    customerVatNumber: null,
    summary: transfer.summary ?? "",
    totalAmount: transfer.totalAmount ?? null,
    paidAmount: transfer.paidAmount ?? null,
    remainingAmount: transfer.remainingAmount ?? 0,
    awaitedTransferAmount: transfer.awaitedTransferAmount ?? null,
    accept: { kind: "TRANSFER", paymentId: transfer.paymentId },
    settleOrderId: null,
  };
}

function rentRow(rent) {
  return {
    key: `rent-${rent.rentId ?? rent.invoiceId}`,
    kind: rent.kind,
    label: rent.number ? `Facture ${rent.number}` : "Loyer",
    origin: ORIGIN_LABELS.RENT,
    invoiceNumber: rent.number ?? null,
    createdAt: rent.createdAt ?? null,
    dueDate: rent.dueDate ?? null,
    customerName: rent.staffName ?? "",
    customerEmail: rent.staffEmail ?? null,
    customerVatNumber: null,
    summary: rent.period ?? "",
    // A rent row carries only what is left: it is never part-paid.
    totalAmount: null,
    paidAmount: null,
    remainingAmount: rent.remainingAmount ?? 0,
    awaitedTransferAmount: null,
    accept: rent.rentId ? { kind: "RENT", rentId: rent.rentId } : { kind: "LEGACY_INVOICE", invoiceId: rent.invoiceId },
    // A younger rent waits for the older one's invoice (numbers in order).
    issueAfter: rent.issueAfter ?? null,
    settleOrderId: null,
  };
}

/** Soonest échéance first; a row without one sorts after, newest first. */
function byDueDate(a, b) {
  const da = a.dueDate ? new Date(a.dueDate).getTime() : Number.POSITIVE_INFINITY;
  const db = b.dueDate ? new Date(b.dueDate).getTime() : Number.POSITIVE_INFINITY;
  if (da !== db) return da - db;
  return new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime();
}

/**
 * @param {{ manualSales?: object[], staffRent?: object[] }} lists - the rows of
 *   listPendingManualSales() (manual sales AND counter transfers) and
 *   listPendingStaffRent().
 */
export function buildPendingPaymentRows({ manualSales = [], staffRent = [] } = {}) {
  return [
    ...manualSales.map((row) => (row.kind === "TRANSFER" ? transferRow(row) : manualSaleRow(row))),
    ...staffRent.map(rentRow),
  ].sort(byDueDate);
}

/**
 * What the « Paiement » column says about a row still owed. An invoice already
 * issued is not passed here at all — in this app it is only ever issued paid.
 */
export function pendingPaymentState(row, now = Date.now()) {
  const due = row?.dueDate ? new Date(row.dueDate).getTime() : null;
  return { late: due != null && due < now, dueDate: row?.dueDate ?? null };
}
