import { buildInvoiceCustomer } from "@/lib/invoicing";

/**
 * issueInvoice's input for a fully-paid manual sale, from its Order: lines,
 * VAT treatment and comment exactly as recorded when the sale was composed.
 * No due date — the invoice is only ever issued paid.
 *
 * Shared by settlement (actions/invoices/manual-invoice.js) and the Factures
 * preview, so the preview is the invoice settling will issue.
 */
export function manualSaleInvoiceInput({ order, buyer, paymentId }) {
  return {
    paymentId,
    source: "MANUAL",
    totalInclVat: Number(order.totalAmount),
    customer: buildInvoiceCustomer(buyer),
    lines: manualSaleInvoiceLines(order),
    vatRate: Number(order.vatRate),
    vatTreatment: order.vatTreatment,
    taxCountryCode: order.taxCountryCode,
    taxNote: order.taxNote,
    notes: order.invoiceNotes || null,
  };
}

/**
 * The lines at face value, plus a promo code as its own negative line — as
 * on every other invoice (orderInvoiceLines) — so they add up to the total.
 */
function manualSaleInvoiceLines(order) {
  const lines = order.items.map((item) => ({
    description: item.variantName ? `${item.productName} — ${item.variantName}` : item.productName,
    quantity: item.quantity,
    unitPrice: Number(item.unitPrice),
  }));
  if (Number(order.discountAmount) > 0) {
    lines.push({ description: "Code promotionnel", quantity: 1, unitPrice: -Number(order.discountAmount) });
  }
  return lines;
}
