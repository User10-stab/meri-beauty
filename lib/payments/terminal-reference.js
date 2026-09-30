import { activityKind } from "@/lib/activities/activity-kind";

/**
 * The reference recorded on a card payment taken on the external terminal
 * (Transaction.manualReference).
 *
 * Staff used to type the terminal ticket's reference on every screen — slow
 * with clients queuing (user's call, 2026-09-28). It is now set here instead,
 * as something staff can read back: « Commande n°36 » for a boutique sale or
 * pickup (its numéro de commande), « Atelier n°01 », « Formation n°03 »,
 * « Événement n°02 » or « Prestation n°12 » for a booking.
 *
 * A booking has no order number (and the salon ticket number is no substitute
 * — an acompte or an independent's sale gets none), so each kind keeps its own
 * terminal sequence in NumberingCounter. Allocated inside the caller's
 * transaction, like every other number here, so a rolled-back collection
 * never burns one.
 */

const BOOKING_LABELS = {
  APPOINTMENT: "Prestation",
  WORKSHOP: "Atelier",
  EVENT: "Événement",
  FORMATION: "Formation",
};

/** @param {number} orderNumber */
export function orderTerminalReference(orderNumber) {
  return `Commande n°${orderNumber}`;
}

/**
 * @param {import("@prisma/client").Prisma.TransactionClient} tx
 * @param {"APPOINTMENT"|"WORKSHOP"|"FORMATION"} kind
 * @param {"WORKSHOP"|"EVENT"|null} [activityType] only read when kind === "WORKSHOP"
 */
export async function allocateBookingTerminalReference(tx, kind, activityType = null) {
  const resolvedKind = kind === "WORKSHOP" ? activityKind(activityType) : kind;
  const key = `TERMINAL-${resolvedKind}`;
  const rows = await tx.$queryRaw`
    INSERT INTO "NumberingCounter" ("key", "lastNumber") VALUES (${key}, 1)
    ON CONFLICT ("key") DO UPDATE SET "lastNumber" = "NumberingCounter"."lastNumber" + 1
    RETURNING "lastNumber"
  `;
  return `${BOOKING_LABELS[resolvedKind]} n°${String(Number(rows[0].lastNumber)).padStart(2, "0")}`;
}
