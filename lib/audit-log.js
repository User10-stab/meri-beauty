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
  STAFF_CREATED: "staff.created",
  STAFF_UPDATED: "staff.updated",
  STAFF_DEACTIVATED: "staff.deactivated",
  CUSTOMER_VAT_NUMBER_OVERRIDDEN: "customer.vat_number_overridden",
};
