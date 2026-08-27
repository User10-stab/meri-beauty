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
  STAFF_CREATED: "staff.created",
  STAFF_UPDATED: "staff.updated",
  STAFF_DEACTIVATED: "staff.deactivated",
  CUSTOMER_VAT_NUMBER_OVERRIDDEN: "customer.vat_number_overridden",
  // A re-send, never the original: the invoice e-mail sent automatically at
  // payment time is not logged here. This records a human deciding to send
  // an already-issued document again, which is the version worth being able
  // to answer for ("the customer says they never got it").
  INVOICE_EMAILED: "invoice.emailed",
  // Order created in Billit, not a delivery confirmation — see the
  // billitOrderId/billitSentAt comment on the Invoice model.
  INVOICE_SENT_TO_BILLIT: "invoice.sent_to_billit",
};
