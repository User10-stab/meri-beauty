import { auth } from "@/auth";
import { getClientIp } from "@/lib/rate-limit";

// Store only deliberately selected business fields. Passwords, tokens, card
// data and raw request bodies must never enter an audit snapshot.
export async function writeAuditLog(db, { action, entityType, entityId, before, after, metadata, actor }) {
  const session = actor ? null : await auth();
  const auditActor = actor ?? session?.user;
  const ipAddress = await getClientIp().catch(() => null);

  return db.auditLog.create({
    data: {
      action,
      entityType,
      entityId: String(entityId),
      ...(before === undefined ? {} : { before }),
      ...(after === undefined ? {} : { after }),
      ...(metadata === undefined ? {} : { metadata }),
      actorId: auditActor?.id ?? null,
      actorRole: auditActor?.role ?? null,
      ipAddress,
    },
  });
}

export const AUDIT_ACTIONS = {
  STOCK_MOVED: "stock.moved",
  ORDER_SHIPPED: "order.shipped",
  ORDER_CANCELLED: "order.cancelled",
  ORDER_COMPLETED: "order.completed",
  RESERVATION_CANCELLED: "reservation.cancelled",
  RESERVATION_COMPLETED: "reservation.completed",
  RESERVATION_REFUNDED: "reservation.refunded",
  WAITING_LIST_CONVERTED: "waiting_list.converted",
  RESERVATION_CHECKED_IN: "reservation.checked_in",
  RESERVATION_PRICE_ADJUSTED: "reservation.price_adjusted",
  RESERVATION_SESSION_TRANSFERRED: "reservation.session_transferred",
  RESERVATION_SEATS_CHANGED: "reservation.seats_changed",
  RESERVATION_PAYMENT_RELAUNCHED: "reservation.payment_relaunched",
  STAFF_CREATED: "staff.created",
  STAFF_UPDATED: "staff.updated",
  STAFF_DEACTIVATED: "staff.deactivated",
  CUSTOMER_VAT_NUMBER_OVERRIDDEN: "customer.vat_number_overridden",
  // A re-send, never the original: the invoice e-mail sent automatically at
  // payment time is not logged here. This records a human deciding to send
  // an already-issued document again, which is the version worth being able
  // to answer for ("the customer says they never got it").
  INVOICE_EMAILED: "invoice.emailed",
  // Transmitted over the live Peppol network via Peppyrus — unlike the old
  // Billit-era entries, this DOES represent an actual transmission attempt,
  // not just a staging step. See peppyrusMessageId/peppyrusSentAt on Invoice.
  INVOICE_SENT_TO_PEPPYRUS: "invoice.sent_to_peppyrus",
  // Same reasoning as INVOICE_EMAILED/INVOICE_SENT_TO_PEPPYRUS, for the
  // correcting document instead of the original.
  CREDIT_NOTE_EMAILED: "credit_note.emailed",
  CREDIT_NOTE_SENT_TO_PEPPYRUS: "credit_note.sent_to_peppyrus",
  // A manual, permission-gated send (actions/payments/send-ticket-email.js).
  // Neither settleReservation nor completeAppointment auto-e-mail the ticket
  // any more, so unlike INVOICE_EMAILED this logs the *only* send there is,
  // not a re-send of something already dispatched automatically.
  TICKET_EMAILED: "ticket.emailed",
  // Same reasoning as TICKET_EMAILED, for the check-in QR/code instead of the
  // till receipt (actions/payments/send-checkin-email.js).
  CHECKIN_TICKET_EMAILED: "checkin_ticket.emailed",
  // Hand-composed sales (actions/invoices/manual-invoice.js). The invoice is
  // issued once the sale is fully paid — at creation when paid in full,
  // otherwise by the payment that clears the balance (INVOICE_MANUAL_SETTLED).
  // Before that the sale is pending: created, part-paid, or cancelled.
  INVOICE_MANUAL_CREATED: "invoice.manual_created",
  INVOICE_MANUAL_SETTLED: "invoice.manual_settled",
  MANUAL_SALE_CREATED: "manual_sale.created",
  MANUAL_SALE_PAYMENT_RECORDED: "manual_sale.payment_recorded",
  MANUAL_SALE_CANCELLED: "manual_sale.cancelled",
  // Staff rent is invoiced when it falls due (automatically, or « Émettre la
  // facture »), paid by transfer, and accepted once the money arrived; a
  // mistake is corrected by a credit note (actions/invoices/staff-rent.js).
  STAFF_RENT_INVOICE_ISSUED: "staff_rent.invoice_issued",
  STAFF_RENT_PAYMENT_ACCEPTED: "staff_rent.payment_accepted",
  STAFF_RENT_CREDITED: "staff_rent.credited",
  // A transfer announced at the counter (booking, pickup, séance), accepted
  // once it reached the account (actions/payments/awaited-transfer.js).
  AWAITED_TRANSFER_ACCEPTED: "counter_transfer.accepted",
};
