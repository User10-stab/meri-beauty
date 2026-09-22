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
    lines: order.items.map((item) => ({
      description: item.variantName ? `${item.productName} — ${item.variantName}` : item.productName,
      quantity: item.quantity,
      unitPrice: Number(item.unitPrice),
    })),
    vatRate: Number(order.vatRate),
    vatTreatment: order.vatTreatment,
    taxCountryCode: order.taxCountryCode,
    taxNote: order.taxNote,
    notes: order.invoiceNotes || null,
  };
}
