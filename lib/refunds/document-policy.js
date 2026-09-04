import { hasInvoiceableVatIdentity } from "@/lib/tax-policy";

/**
 * Refund documents follow the exact same boundary as invoices: only a
 * reusable VIES validation makes a customer B2B. A profile can be marked as
 * a company while remaining B2C (for example a test profile or an incomplete
 * company profile with no VAT number), and may then receive a plain B2C
 * confirmation e-mail rather than a financial document or credit note.
 */
export function isBusinessRefundCustomer(customer) {
  return hasInvoiceableVatIdentity(customer);
}

export function refundCustomerFromContext(context) {
  return (
    context?.appointment?.user ??
    context?.workshopReservation?.customer ??
    context?.formationReservation?.customer ??
    context?.order?.user ??
    null
  );
}
