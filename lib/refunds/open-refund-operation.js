/**
 * "Annuler et rembourser", the part this application actually performs:
 * everything except moving the money.
 *
 * One transaction takes the locks, verifies the authorization, writes the
 * RefundOperation and its legs, issues the accounting document, cancels the
 * underlying item and releases its seats or stock. Then it returns, having
 * moved nothing.
 *
 * It never calls Stripe — not because a SQL transaction cannot span a
 * network call (it cannot, but that is not the reason), but because of a
 * confirmed policy decision on 2026-09-02: an OWNER/ADMIN performs every
 * card refund by hand in the Stripe dashboard. What commits here is the
 * decision and the instruction; the money follows separately and is
 * reconciled by the charge.refunded webhook.
 *
 * The legs are therefore the deliverable, not a queue of work to execute.
 * They say what is owed, by which method, against which original payment —
 * which is exactly the arithmetic a person refunding by hand at a counter
 * would otherwise have to do from an invoice total that does not match what
 * Stripe took.
 */

import { Prisma } from "@prisma/client";
import { issueCreditNote } from "@/lib/invoicing";
import { allocatePieceNumber, PIECE_SERIES, seriesForActivityType } from "@/lib/cash-book/piece-number";
import { planRefund, REFUND_EPSILON } from "@/lib/refunds/plan-refund";
import { allocateRefundReceiptNumber } from "@/lib/refunds/refund-receipt-number";
import { isBusinessRefundCustomer, refundCustomerFromContext } from "@/lib/refunds/document-policy";
import {
  authorizeRefund,
  cancelsUnderlyingItem,
  refundDenialMessage,
  releasesCapacity,
  REFUND_DENIAL,
} from "@/lib/refunds/authorize";

/**
 * Everything the planner, the authorizer and the cancellation step need,
 * read in one go. Kept as one constant because openRefundOperation reads it
 * twice — once before the transaction to fail fast with a good message, and
 * once inside it on locked rows, which is the read that actually counts.
 */
const PAYMENT_CONTEXT = {
  id: true,
  paidAmount: true,
  status: true,
  transactionReference: true,
  pendingRefundAmount: true,
  appointmentId: true,
  orderId: true,
  workshopReservationId: true,
  formationReservationId: true,
  transactions: {
    select: {
      id: true,
      amount: true,
      method: true,
      transactionType: true,
      paidAt: true,
      isDeleted: true,
      stripeCheckoutSessionId: true,
      stripePaymentIntentId: true,
    },
  },
  invoice: {
    select: {
      id: true,
      number: true,
      totalInclVat: true,
      creditNotes: { select: { id: true, number: true, totalInclVat: true } },
    },
  },
  appointment: {
    select: {
      id: true,
      status: true,
      date: true,
      notes: true,
      user: { select: { id: true, fullName: true, email: true, isCompany: true, vatNumber: true } },
    },
  },
  workshopReservation: {
    select: {
      id: true,
      status: true,
      seatsCount: true,
      sessionId: true,
      notes: true,
      session: { select: { id: true, workshop: { select: { title: true, type: true } } } },
      customer: { select: { id: true, fullName: true, email: true, isCompany: true, vatNumber: true } },
      cancellationRequest: { select: { id: true, status: true, reason: true, reviewedByUserId: true } },
    },
  },
  formationReservation: {
    select: {
      id: true,
      status: true,
      seatsCount: true,
      sessionId: true,
      notes: true,
      session: { select: { id: true, formation: { select: { title: true } } } },
      customer: { select: { id: true, fullName: true, email: true, isCompany: true, vatNumber: true } },
      cancellationRequest: { select: { id: true, status: true, reason: true, reviewedByUserId: true } },
    },
  },
  order: {
    select: {
      id: true,
      orderNumber: true,
      status: true,
      promoCodeId: true,
      user: { select: { id: true, fullName: true, email: true, isCompany: true, vatNumber: true } },
      items: { select: { id: true, variantId: true, quantity: true } },
    },
  },
};

export class RefundNotAllowedError extends Error {
  constructor(code, message) {
    super(message ?? refundDenialMessage(code));
    this.name = "RefundNotAllowedError";
    this.code = code;
  }
}

/** Which of Payment's four polymorphic sources is set. */
export function resolveRefundSource(payment) {
  if (payment.appointmentId) return "APPOINTMENT";
  if (payment.workshopReservationId) return "WORKSHOP";
  if (payment.formationReservationId) return "FORMATION";
  // A counter sale is an Order too, but one with no shipping and often no
  // invoice. POS is decided by the caller (it knows it came from the till),
  // never inferred here.
  if (payment.orderId) return "ORDER";
  return null;
}

export function loadRefundContext(db, paymentId) {
  return db.payment.findUnique({ where: { id: paymentId }, select: PAYMENT_CONTEXT });
}

/**
 * Restores stock for a cancelled, already-paid order and gives back the
 * promo code use.
 *
 * `items` is the subset actually being unwound — a full cancellation passes
 * every line, a partial return passes only what physically came back. The
 * handoff is explicit: "restaurer uniquement les quantités réellement
 * concernées".
 */
async function restoreOrderStock(tx, { order, items, reasonLabel }) {
  for (const item of items) {
    // POS ad-hoc service lines carry no variant and no stock to adjust.
    if (!item.variantId) continue;
    const updated = await tx.productVariant.update({
      where: { id: item.variantId },
      data: { stockQuantity: { increment: item.quantity } },
    });
    await tx.inventoryMovement.create({
      data: {
        variantId: item.variantId,
        type: "RETURN",
        quantity: item.quantity,
        previousStock: updated.stockQuantity - item.quantity,
        newStock: updated.stockQuantity,
        reason: reasonLabel,
      },
    });
  }

  // Only a whole-order cancellation frees the code. A partial return leaves
  // it consumed: the customer did use it on the part they kept.
  const fullCancellation = items.length === order.items.length;
  if (order.promoCodeId && fullCancellation) {
    await tx.promoCode.updateMany({
      where: { id: order.promoCodeId, usedCount: { gt: 0 } },
      data: { usedCount: { decrement: 1 } },
    });
  }
}

/**
 * Cancels the underlying booking/order and releases its capacity.
 *
 * Every write is an `updateMany` gated on the status it expects, so a
 * concurrent cancellation loses the race cleanly instead of both sides
 * releasing the same seat. Returns what was actually released so the caller
 * can decide whether to wake the waiting list.
 */
async function cancelUnderlyingItem(tx, { source, context, reason, releaseCapacity, actorUserId }) {
  const now = new Date();
  const note = `Annulation et remboursement : ${reason}`;

  if (source === "APPOINTMENT") {
    const appointment = context.appointment;
    if (!appointment) return { cancelled: false, releasedSeats: 0 };
    const claim = await tx.appointment.updateMany({
      where: { id: appointment.id, status: { in: ["PENDING", "ACCEPTED", "CONFIRMED"] } },
      data: {
        status: "CANCELLED",
        cancelledAt: now,
        cancellationReason: reason,
        cancellationSource: "ADMIN",
        notes: appointment.notes ? `${appointment.notes}\n${note}` : note,
      },
    });
    return { cancelled: claim.count > 0, releasedSeats: claim.count > 0 ? 1 : 0 };
  }

  if (source === "WORKSHOP" || source === "FORMATION") {
    const reservation = source === "WORKSHOP" ? context.workshopReservation : context.formationReservation;
    if (!reservation) return { cancelled: false, releasedSeats: 0 };
    const model = source === "WORKSHOP" ? tx.workshopReservation : tx.formationReservation;
    // Capacity is derived from CONFIRMED reservations rather than a counter,
    // so flipping the status IS the seat release — there is no separate
    // number to decrement and therefore no way for the two to disagree.
    const claim = await model.updateMany({
      where: { id: reservation.id, status: { in: ["PENDING_DEPOSIT", "CONFIRMED"] } },
      data: {
        status: "CANCELLED",
        cancelledAt: now,
        notes: reservation.notes ? `${reservation.notes}\n${note}` : note,
      },
    });
    return {
      cancelled: claim.count > 0,
      // Only a full refund puts the seat back on sale — a partially
      // refunded reservation is still a reservation. See
      // docs/REFUND_OPERATING_PROCEDURE.md and authorize.js#releasesCapacity.
      releasedSeats: claim.count > 0 && releaseCapacity ? Number(reservation.seatsCount ?? 1) : 0,
      sessionId: reservation.sessionId,
    };
  }

  if (source === "ORDER" || source === "POS") {
    const order = context.order;
    if (!order) return { cancelled: false, releasedSeats: 0 };
    const claim = await tx.order.updateMany({
      where: { id: order.id, status: { notIn: ["CANCELLED"] } },
      data: { status: "CANCELLED", cancelledAt: now, cancelReason: reason },
    });
    if (claim.count > 0 && releaseCapacity) {
      await restoreOrderStock(tx, {
        order,
        items: order.items,
        reasonLabel: `Commande n°${order.orderNumber} annulée et remboursée`,
      });
    }
    return { cancelled: claim.count > 0, releasedSeats: 0 };
  }

  return { cancelled: false, releasedSeats: 0 };
}

/**
 * The cash-book series a CASH refund is booked under, so the outflow lands
 * in the same series as the sale it reverses rather than in a series of its
 * own that no one reconciles.
 */
function pieceSeriesFor(source, context) {
  if (source === "ORDER" || source === "POS") return PIECE_SERIES.ORDER;
  if (source === "APPOINTMENT") return PIECE_SERIES.APPOINTMENT;
  if (source === "FORMATION") return PIECE_SERIES.FORMATION;
  return seriesForActivityType(context.workshopReservation?.session?.workshop?.type);
}

/**
 * Opens (or resumes) the one refund operation for a payment.
 *
 * @param {object} input
 * @param {import("@prisma/client").PrismaClient} input.prisma
 * @param {string} input.paymentId
 * @param {"APPOINTMENT"|"WORKSHOP"|"FORMATION"|"ORDER"|"POS"} [input.source] - defaults to the payment's own
 * @param {"CUSTOMER_REQUEST_APPROVED"|"SALON_CANCELLATION"|"NO_SHOW_EXCEPTION"|"FINANCIAL_CORRECTION"|"SHOP_RETURN"} input.trigger
 * @param {string} input.reason
 * @param {{id: string, role: string}} input.actor
 * @param {number|null} [input.requestedAmount] - null = everything still refundable
 * @param {string|null} [input.returnRequestId]
 * @param {Array<{variantId: string|null, quantity: number}>|null} [input.restockItems] - partial return only
 * @returns {Promise<{operation: object, plan: object, released: object, resumed: boolean}>}
 */
export async function openRefundOperation({
  prisma,
  paymentId,
  source: sourceOverride = null,
  trigger,
  reason,
  actor,
  requestedAmount = null,
  returnRequestId = null,
  restockItems = null,
}) {
  const preflight = await loadRefundContext(prisma, paymentId);
  if (!preflight) throw new RefundNotAllowedError(REFUND_DENIAL.NO_PAYMENT_COLLECTED, "Paiement introuvable.");

  return prisma.$transaction(async (tx) => {
    // Serialize every refund decision about this payment. An advisory lock
    // rather than SELECT ... FOR UPDATE on Payment because the rows that
    // must not move underneath us span four tables (payment, invoice,
    // reservation, order) and a transaction-scoped advisory lock covers the
    // whole decision without lock-ordering deadlocks between them.
    await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`refund-operation:${paymentId}`}))`);

    const context = await loadRefundContext(tx, paymentId);
    if (!context) throw new RefundNotAllowedError(REFUND_DENIAL.NO_PAYMENT_COLLECTED, "Paiement introuvable.");

    const source = sourceOverride ?? resolveRefundSource(context);

    // An operation already in flight is RESUMED, never duplicated. This is
    // the double-click answer, and also the "Stripe échoué puis
    // réconciliation" answer: the existing operation is returned for
    // follow-up rather than creating a second refund.
    const inFlight = await tx.refundOperation.findFirst({
      where: { paymentId, status: { in: ["PENDING", "PARTIALLY_REFUNDED"] } },
      include: { legs: true },
    });
    if (inFlight) {
      return {
        operation: inFlight,
        plan: planRefund({ transactions: context.transactions, invoice: context.invoice, requestedAmount }),
        released: { cancelled: false, releasedSeats: 0 },
        resumed: true,
      };
    }

    const plan = planRefund({
      transactions: context.transactions,
      invoice: context.invoice,
      requestedAmount,
    });

    const reservation =
      source === "WORKSHOP" ? context.workshopReservation
      : source === "FORMATION" ? context.formationReservation
      : null;

    // The approved request is read from the reservation/appointment itself,
    // never passed in by the caller — a caller that could name its own
    // authorization evidence is not an authorization check.
    const cancellationRequest =
      source === "APPOINTMENT"
        ? await tx.appointmentCancellationRequest.findUnique({
            where: { appointmentId: context.appointment?.id ?? "" },
            select: { id: true, status: true, reason: true, reviewedByUserId: true },
          })
        : (reservation?.cancellationRequest ?? null);

    const verdict = authorizeRefund({
      actorRole: actor.role,
      source,
      trigger,
      reason,
      state: plan,
      appointment: context.appointment,
      reservation,
      order: context.order,
      returnRequest: returnRequestId ? await tx.returnRequest.findUnique({ where: { id: returnRequestId } }) : null,
      cancellationRequest,
      payment: context,
    });
    if (!verdict.allowed) throw new RefundNotAllowedError(verdict.code, verdict.message);

    if (plan.legs.length === 0) {
      throw new RefundNotAllowedError(
        REFUND_DENIAL.NO_PAYMENT_COLLECTED,
        plan.overRequested
          ? "Le montant demandé dépasse ce qui reste remboursable."
          : refundDenialMessage(REFUND_DENIAL.NO_PAYMENT_COLLECTED),
      );
    }

    // ── The accounting document ────────────────────────────────────────
    // ONE global correction for the whole operation, never one per payment
    // method. A 21 € reservation settled 10,50 € online + 10,50 € cash gets
    // a single 21 € credit note, settled by two refund movements.
    let creditNote = null;
    let refundReceiptNumber = null;
    if (context.invoice) {
      // A fully-credited invoice is never credited again — two old partial
      // notes summing to the total count as complete. The refund still
      // proceeds; only the paperwork is skipped.
      if (!plan.fullyCredited) {
        const creditable = Math.min(plan.plannedTotal, plan.remainingCreditable ?? plan.plannedTotal);
        if (creditable > REFUND_EPSILON) {
          creditNote = await issueCreditNote(tx, {
            invoiceId: context.invoice.id,
            reason,
            totalInclVat: creditable,
          });
        }
      }
    } else {
      if (isBusinessRefundCustomer(refundCustomerFromContext(context))) {
        throw new RefundNotAllowedError(
          "B2B_INVOICE_REQUIRED",
          "Client B2B détecté, mais aucune facture n'est liée au paiement. Corrigez d'abord la facture : un B2B doit recevoir une note de crédit, jamais un justificatif B2C.",
        );
      }
      // B2C: no invoice was ever issued, so there is nothing to credit. The
      // movement still needs a justificatif — see refund-receipt-number.js.
      refundReceiptNumber = await allocateRefundReceiptNumber(tx);
    }

    // ── Cancel the item and release its resources ──────────────────────
    const releaseCapacity = releasesCapacity({
      trigger,
      plannedTotal: plan.plannedTotal,
      remainingRefundable: plan.remainingRefundable,
    });
    const released = cancelsUnderlyingItem(trigger)
      ? await cancelUnderlyingItem(tx, {
          source,
          context: restockItems ? { ...context, order: { ...context.order, items: restockItems } } : context,
          reason,
          releaseCapacity,
          actorUserId: actor.id,
        })
      : // NO_SHOW keeps its status: the customer really did not turn up, and
        // rewriting that to CANCELLED would erase the fact to make the
        // refund tidier.
        { cancelled: false, releasedSeats: 0, keptHistoricalStatus: true };

    // ── The operation and its legs ─────────────────────────────────────
    // Built with a sequential loop, deliberately not Promise.all: an
    // interactive transaction runs on ONE connection, so concurrent queries
    // against `tx` are not actually concurrent and can error outright. It
    // would also race allocatePieceNumber against itself, which is the one
    // thing a gapless cash-book series must never do.
    const openCashSession = plan.legs.some((leg) => leg.method === "CASH")
      ? await tx.cashSession.findFirst({ where: { closedAt: null }, select: { id: true } })
      : null;

    const legData = [];
    for (const leg of plan.legs) {
      legData.push({
        sourceTransactionId: leg.sourceTransactionId,
        method: leg.method,
        amount: leg.amount,
        // Every leg now waits on a person; the two statuses record WHO
        // confirms it, which is a real distinction and drives two different
        // screens:
        //
        //   PENDING  (ONLINE) — an admin refunds it by hand in the Stripe
        //     dashboard. Nobody ticks a box here: the charge.refunded
        //     webhook settles it, because Stripe's own event is better
        //     evidence than an admin asserting they did it.
        //   MANUAL_CONFIRMATION_REQUIRED (CASH/CARD) — money Stripe knows
        //     nothing about. Only a human can attest it moved.
        status: leg.method === "ONLINE" ? "PENDING" : "MANUAL_CONFIRMATION_REQUIRED",
        // No idempotency key: this application never calls stripe.refunds
        // .create (confirmed policy, 2026-09-02). The column stays for the
        // historical rows that have one, but minting a key for a request
        // that will never be sent would imply a call site that no longer
        // exists.
        stripeIdempotencyKey: null,
        // Kept, and load-bearing now — it is what the panel shows the admin
        // so they refund against the right payment, and what the webhook
        // matches on when the refund comes back.
        stripePaymentIntentId: leg.stripePaymentIntentId,
        // A cash refund is a real cash-book line and needs its number
        // allocated in this same transaction, or the book gains a gap.
        pieceNumber: leg.method === "CASH" ? await allocatePieceNumber(tx, pieceSeriesFor(source, context)) : null,
        cashSessionId: leg.method === "CASH" ? openCashSession?.id ?? null : null,
      });
    }

    const operation = await tx.refundOperation.create({
      data: {
        paymentId,
        invoiceId: context.invoice?.id ?? null,
        source,
        trigger,
        totalAmount: plan.plannedTotal,
        reason,
        creditNoteId: creditNote?.id ?? null,
        refundReceiptNumber,
        decidedByUserId: actor.id,
        status: "PENDING",
        itemCancelledAt: released.cancelled ? new Date() : null,
        appointmentCancellationRequestId:
          trigger === "CUSTOMER_REQUEST_APPROVED" && source === "APPOINTMENT" ? cancellationRequest?.id ?? null : null,
        reservationCancellationRequestId:
          trigger === "CUSTOMER_REQUEST_APPROVED" && (source === "WORKSHOP" || source === "FORMATION")
            ? cancellationRequest?.id ?? null
            : null,
        returnRequestId,
        legs: { create: legData },
      },
      include: { legs: true, creditNote: true },
    });

    await tx.auditLog.create({
      data: {
        actorId: actor.id,
        actorRole: actor.role,
        action: "refund.operation_opened",
        entityType: "RefundOperation",
        entityId: operation.id,
        metadata: {
          paymentId,
          source,
          trigger,
          reason,
          totalAmount: plan.plannedTotal,
          automaticTotal: plan.automaticTotal,
          manualTotal: plan.manualTotal,
          creditNoteNumber: creditNote?.number ?? null,
          refundReceiptNumber,
          itemCancelled: released.cancelled,
          releasedSeats: released.releasedSeats,
          keptHistoricalStatus: released.keptHistoricalStatus ?? false,
          legs: operation.legs.map((leg) => ({ method: leg.method, amount: Number(leg.amount), status: leg.status })),
        },
      },
    });

    return { operation, plan, released, resumed: false };
  });
}
