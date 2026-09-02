/**
 * Records what is owed to a customer, for an admin to pay back by hand.
 *
 * This is the replacement for the `stripe.refunds.create(...)` block that
 * used to sit inside each of the five cancellation actions. Confirmed policy
 * (2026-09-02): the application never issues a Stripe refund itself.
 *
 * Deleting those calls on their own would have been the worst possible
 * outcome — the booking still cancelled, the credit note still issued, and
 * the money silently never sent. That is precisely the state the audit found
 * nine times over. So the call is not removed, it is *redirected*: what was
 * a network request becomes a row on the Operations worklist, carrying the
 * exact amount and the payment_intent to refund it against.
 *
 * Deliberately narrower than openRefundOperation. The callers have already
 * cancelled their booking, restocked, released the seat and issued their own
 * credit note inside their own transaction — they do not need any of that
 * done again, and re-running it would double-restock. All they need is the
 * money side recorded.
 */

import { allocateRefund, REFUND_EPSILON } from "@/lib/refunds/plan-refund";
import { allocatePieceNumber, PIECE_SERIES, seriesForActivityType } from "@/lib/cash-book/piece-number";

/**
 * The cash-book series a CASH refund is booked under, so the outflow lands
 * in the same series as the sale it reverses.
 */
function pieceSeriesFor(source, activityType) {
  if (source === "ORDER" || source === "POS") return PIECE_SERIES.ORDER;
  if (source === "APPOINTMENT") return PIECE_SERIES.APPOINTMENT;
  if (source === "FORMATION") return PIECE_SERIES.FORMATION;
  return seriesForActivityType(activityType);
}

/**
 * @param {import("@prisma/client").Prisma.TransactionClient} tx - MUST be the
 *   caller's own transaction, so the refund record commits or rolls back with
 *   the cancellation that justifies it.
 * @param {object} input
 * @param {string} input.paymentId
 * @param {"APPOINTMENT"|"WORKSHOP"|"FORMATION"|"ORDER"|"POS"} input.source
 * @param {"CUSTOMER_REQUEST_APPROVED"|"SALON_CANCELLATION"|"NO_SHOW_EXCEPTION"|"SHOP_RETURN"} input.trigger
 * @param {string} input.reason
 * @param {number} input.amount - what to pay back in total
 * @param {Array} input.transactions - the payment's transaction rows
 * @param {string|null} [input.creditNoteId] - the note the caller already issued
 * @param {string|null} [input.invoiceId]
 * @param {string|null} [input.decidedByUserId]
 * @param {string|null} [input.activityType] - WORKSHOP/EVENT, for the cash-book series
 * @param {string|null} [input.returnRequestId]
 * @returns {Promise<{operationId: string, legs: Array}|null>} null when there is nothing to refund
 */
export async function queueManualRefund(
  tx,
  {
    paymentId,
    source,
    trigger,
    reason,
    amount,
    transactions = [],
    creditNoteId = null,
    invoiceId = null,
    decidedByUserId = null,
    activityType = null,
    returnRequestId = null,
  },
) {
  if (!(Number(amount) > REFUND_EPSILON)) return null;

  // One operation in flight per payment is a database guarantee (see the
  // partial unique index in 20260902160000_add_refund_operations). Checking
  // here as well turns a would-be constraint violation — which would roll
  // back the caller's entire cancellation — into a clean no-op.
  const inFlight = await tx.refundOperation.findFirst({
    where: { paymentId, status: { in: ["PENDING", "PARTIALLY_REFUNDED"] } },
    select: { id: true },
  });
  if (inFlight) return { operationId: inFlight.id, legs: [], alreadyOpen: true };

  const planned = allocateRefund(transactions, Number(amount));
  if (planned.length === 0) return null;

  const openCashSession = planned.some((leg) => leg.method === "CASH")
    ? await tx.cashSession.findFirst({ where: { closedAt: null }, select: { id: true } })
    : null;

  // Sequential, not Promise.all: an interactive transaction runs on one
  // connection, and allocatePieceNumber must not race itself.
  const legData = [];
  for (const leg of planned) {
    legData.push({
      sourceTransactionId: leg.sourceTransactionId,
      method: leg.method,
      amount: leg.amount,
      // ONLINE waits on the admin refunding it in Stripe; the webhook
      // settles it. CASH/CARD waits on a hand-over the admin attests to.
      status: leg.method === "ONLINE" ? "PENDING" : "MANUAL_CONFIRMATION_REQUIRED",
      // The payment_intent is what the Operations panel prints so the admin
      // refunds against the right charge, for the right amount.
      stripePaymentIntentId: leg.stripePaymentIntentId,
      pieceNumber:
        leg.method === "CASH" ? await allocatePieceNumber(tx, pieceSeriesFor(source, activityType)) : null,
      cashSessionId: leg.method === "CASH" ? openCashSession?.id ?? null : null,
    });
  }

  const operation = await tx.refundOperation.create({
    data: {
      paymentId,
      invoiceId,
      source,
      trigger,
      totalAmount: legData.reduce((sum, leg) => sum + Number(leg.amount), 0),
      reason,
      creditNoteId,
      decidedByUserId,
      status: "PENDING",
      // The caller cancelled its own booking before calling this, so the
      // cancellation is already a fact by the time this row exists.
      itemCancelledAt: new Date(),
      returnRequestId,
      legs: { create: legData },
    },
    include: { legs: true },
  });

  await tx.auditLog.create({
    data: {
      actorId: decidedByUserId,
      actorRole: null,
      action: "refund.queued_for_manual_execution",
      entityType: "RefundOperation",
      entityId: operation.id,
      metadata: {
        paymentId,
        source,
        trigger,
        reason,
        totalAmount: Number(operation.totalAmount),
        creditNoteId,
        legs: operation.legs.map((leg) => ({
          method: leg.method,
          amount: Number(leg.amount),
          stripePaymentIntentId: leg.stripePaymentIntentId,
        })),
      },
    },
  });

  return { operationId: operation.id, legs: operation.legs, alreadyOpen: false };
}
