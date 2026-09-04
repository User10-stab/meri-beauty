/**
 * Step 3: record that money actually moved.
 *
 * A leg becomes SUCCEEDED here and nowhere else. Two callers reach it:
 *
 *   - the Stripe charge.refunded webhook, for ONLINE legs;
 *   - an admin confirming a physical hand-over, for CASH/CARD legs.
 *
 * Both go through the same function because both have to do the same four
 * things atomically — write the REFUND Transaction, link it to the credit
 * note, flip the leg, and recompute the operation and payment status — and
 * because the moment they drift is the moment the cash book and the Stripe
 * balance stop agreeing with the ledger.
 *
 * Settlement is idempotent by construction. A leg already SUCCEEDED is a
 * no-op, so a webhook delivered twice (Stripe's at-least-once guarantee, or
 * a replay from the dashboard) settles once and mails once.
 */

import { Prisma } from "@prisma/client";
import { refreshOperationStatus } from "@/lib/refunds/operation-status";
import { REFUND_EPSILON } from "@/lib/refunds/plan-refund";

/** Money rounding, same as lib/tax-policy.js#roundMoney. */
function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

/**
 * Recomputes Payment.status from the ledger after a refund lands.
 *
 * Derived from the transactions rather than assumed from the operation: a
 * payment can carry refunds from several operations over time, and only the
 * sum of them decides whether it is now REFUNDED or PARTIALLY_REFUNDED.
 */
async function refreshPaymentStatus(tx, paymentId) {
  const payment = await tx.payment.findUnique({
    where: { id: paymentId },
    select: {
      paidAmount: true,
      transactions: { where: { isDeleted: false }, select: { amount: true, transactionType: true } },
    },
  });
  if (!payment) return null;

  const refunded = payment.transactions
    .filter((t) => t.transactionType === "REFUND")
    .reduce((sum, t) => sum + Number(t.amount), 0);

  if (refunded <= REFUND_EPSILON) return null;

  const status = refunded + REFUND_EPSILON >= Number(payment.paidAmount) ? "REFUNDED" : "PARTIALLY_REFUNDED";
  await tx.payment.update({
    where: { id: paymentId },
    data: {
      status,
      // The legacy pin is cleared on the way past. While the five old refund
      // paths still exist, leaving a stale pendingRefundAmount behind would
      // keep the interlock in authorize.js refusing every future refund on
      // this payment.
      pendingRefundAmount: null,
      pendingRefundIdempotencyKey: null,
      pendingRefundCreditNoteId: null,
    },
  });
  return status;
}

/**
 * Settles one leg.
 *
 * @param {object} input
 * @param {import("@prisma/client").PrismaClient} input.prisma
 * @param {string} input.legId
 * @param {object} [input.stripe] - { refundId, paymentIntentId } for an ONLINE leg
 * @param {object} [input.manual] - { confirmedByUserId, terminalReference, cashHandedOver }
 * @returns {Promise<{settled: boolean, reason?: string, operationId: string|null, operationStatus: string|null}>}
 */
export async function settleRefundLeg({ prisma, legId, stripe = null, manual = null }) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.refundLeg.findUnique({
      where: { id: legId },
      select: { refundOperationId: true },
    });
    if (!existing) return { settled: false, reason: "LEG_NOT_FOUND", operationId: null, operationStatus: null };

    // Serialize every settlement touching this operation — two legs of one
    // operation settling at the same instant would otherwise both read
    // "one leg outstanding" and neither would mark it COMPLETED.
    await tx.$executeRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`refund-settle:${existing.refundOperationId}`}))`,
    );

    const leg = await tx.refundLeg.findUnique({
      where: { id: legId },
      include: {
        refundOperation: { select: { id: true, paymentId: true, creditNoteId: true, source: true } },
        sourceTransaction: { select: { stripeCheckoutSessionId: true } },
      },
    });
    if (!leg) return { settled: false, reason: "LEG_NOT_FOUND", operationId: null, operationStatus: null };

    // A previously observed refund id is a replay. A different id is a
    // legitimate second Stripe refund (for example, an under-refund followed
    // by a top-up) and must be recorded against the same leg.
    const observedStripeRefundIds = leg.stripeRefundIds ?? [];
    if (
      leg.status === "SUCCEEDED" &&
      (leg.settledAmount == null ||
        !stripe?.refundId ||
        observedStripeRefundIds.includes(stripe.refundId) ||
        leg.stripeRefundId === stripe.refundId)
    ) {
      return {
        settled: false,
        reason: "ALREADY_SETTLED",
        operationId: leg.refundOperationId,
        operationStatus: null,
      };
    }

    // A CARD refund without its terminal ticket reference is not evidence of
    // anything — the handoff makes the reference mandatory, so it is
    // enforced here rather than only in the form.
    if (manual && leg.method === "CARD" && !manual.terminalReference?.trim()) {
      return {
        settled: false,
        reason: "TERMINAL_REFERENCE_REQUIRED",
        operationId: leg.refundOperationId,
        operationStatus: null,
      };
    }
    if (manual && leg.method === "CASH" && manual.cashHandedOver !== true) {
      return {
        settled: false,
        reason: "CASH_HANDOVER_NOT_CONFIRMED",
        operationId: leg.refundOperationId,
        operationStatus: null,
      };
    }

    // What actually came back. For a CASH/CARD hand-over it is by
    // definition the planned figure — an admin confirming "I gave back
    // 10,50 €" is confirming that leg. For an ONLINE leg it is whatever the
    // admin typed into Stripe, which is NOT guaranteed to match: the
    // invoice says 21 € and only 10,50 € ever went through Stripe, so
    // over-refunding there is the single most likely human error in this
    // whole flow. Recording Stripe's own figure rather than the planned one
    // is what stops the ledger quietly agreeing with a mistake.
    const plannedAmount = Number(leg.amount);
    // `stripe.amount` is the INCREMENT this event represents, not a running
    // total — the webhook derives it per refund, or from amount_refunded
    // minus what the ledger already holds. A leg can therefore be settled
    // more than once if an admin refunds in two goes.
    const priorSettled = Number(leg.settledAmount ?? 0);
    const increment = stripe?.amount != null ? Number(stripe.amount) : plannedAmount;
    const cumulative = round2(priorSettled + increment);

    const shortfall = round2(plannedAmount - cumulative);
    const underRefunded = shortfall > REFUND_EPSILON;
    const overRefunded = cumulative - plannedAmount > REFUND_EPSILON;
    const mismatched = underRefunded || overRefunded;

    const refundTransaction = await tx.transaction.create({
      data: {
        paymentId: leg.refundOperation.paymentId,
        // The money that moved in THIS event, never the running total —
        // writing the cumulative figure would double-count the earlier part.
        amount: increment,
        method: leg.method,
        transactionType: "REFUND",
        paidAt: new Date(),
        // Several REFUND rows may point at one credit note — that is exactly
        // what dropping Transaction.creditNoteId's unique constraint bought,
        // and what lets one 21 € note cover a 10,50 € Stripe payout plus a
        // 10,50 € cash hand-over.
        creditNoteId: leg.refundOperation.creditNoteId,
        // No stripeRefundId column here on purpose — Transaction has never
        // carried one, and the refund id lives on the RefundLeg that points
        // at this row (RefundLeg.refundTransactionId). Adding a duplicate
        // here would give reconciliation two places to disagree.
        stripePaymentIntentId: stripe?.paymentIntentId ?? leg.stripePaymentIntentId ?? null,
        stripeCheckoutSessionId: leg.sourceTransaction?.stripeCheckoutSessionId ?? null,
        manualReference: manual?.terminalReference?.trim() ?? null,
        // Carried over from the leg, where it was allocated inside the
        // opening transaction so the cash book never gains a gap.
        cashSessionId: leg.cashSessionId,
        pieceNumber: leg.pieceNumber,
      },
    });

    await tx.refundLeg.update({
      where: { id: leg.id },
      data: {
        // SUCCEEDED even when short: the Stripe refund really did happen,
        // and leaving the leg unsettled would let a redelivered webhook
        // record the same money a second time. What a shortfall must NOT do
        // is let the operation complete or the customer be told the full
        // figure went back — that is enforced from `settledAmount` in
        // operation-status.js and notify-refund-complete.js instead.
        status: "SUCCEEDED",
        refundTransactionId: refundTransaction.id,
        // Only recorded when it differs — a null settledAmount reads as
        // "went back exactly as planned", which is the normal case.
        settledAmount: mismatched ? cumulative : null,
        stripeRefundId: stripe?.refundId ?? leg.stripeRefundId,
        stripeRefundIds: stripe?.refundId
          ? {
              set: [
                ...new Set([...observedStripeRefundIds, leg.stripeRefundId, stripe.refundId].filter(Boolean)),
              ],
            }
          : undefined,
        stripePaymentIntentId: stripe?.paymentIntentId ?? leg.stripePaymentIntentId,
        terminalReference: manual?.terminalReference?.trim() ?? leg.terminalReference,
        cashHandedOver: manual?.cashHandedOver === true ? true : leg.cashHandedOver,
        confirmedByUserId: manual?.confirmedByUserId ?? null,
        confirmedAt: new Date(),
        // Not a failure — the leg did settle. But a refund that does not
        // match its plan is something a human has to look at, and this is
        // the field the dashboard already surfaces.
        failureReason: underRefunded
          ? `Remboursé ${cumulative.toFixed(2)} € sur ${plannedAmount.toFixed(2)} € prévus — il reste ${shortfall.toFixed(2)} € à rembourser.`
          : overRefunded
            ? `Remboursé ${cumulative.toFixed(2)} € alors que ${plannedAmount.toFixed(2)} € étaient prévus — trop-perçu de ${(cumulative - plannedAmount).toFixed(2)} €.`
            : null,
      },
    });

    const operationStatus = await refreshOperationStatus(tx, leg.refundOperationId);
    await refreshPaymentStatus(tx, leg.refundOperation.paymentId);

    await tx.auditLog.create({
      data: {
        actorId: manual?.confirmedByUserId ?? null,
        actorRole: manual?.confirmedByUserId ? "ADMIN" : null,
        action: manual ? "refund.leg_confirmed_manually" : "refund.leg_settled_by_webhook",
        entityType: "RefundLeg",
        entityId: leg.id,
        metadata: {
          refundOperationId: leg.refundOperationId,
          paymentId: leg.refundOperation.paymentId,
          method: leg.method,
          plannedAmount,
          settledThisEvent: increment,
          settledCumulative: cumulative,
          shortfall: underRefunded ? shortfall : 0,
          amountMismatch: mismatched,
          transactionId: refundTransaction.id,
          stripeRefundId: stripe?.refundId ?? leg.stripeRefundId ?? null,
          terminalReference: manual?.terminalReference?.trim() ?? null,
          pieceNumber: leg.pieceNumber,
          operationStatus,
        },
      },
    });

    return { settled: true, operationId: leg.refundOperationId, operationStatus };
  });
}

/**
 * Finds the leg a Stripe refund belongs to.
 *
 * Matches on `stripeRefundId` first (set by executeOnlineLegs the moment
 * Stripe answered) and falls back to the payment_intent when the response
 * that carried the id was the thing that got lost — which is precisely the
 * case a webhook is best placed to repair.
 */
export async function findLegForStripeRefund(prisma, { refundId, paymentIntentId }) {
  if (refundId) {
    const byRefundId = await prisma.refundLeg.findFirst({
      where: { OR: [{ stripeRefundId: refundId }, { stripeRefundIds: { has: refundId } }] },
    });
    if (byRefundId) return byRefundId;
  }
  if (!paymentIntentId) return null;
  return prisma.refundLeg.findFirst({
    where: {
      stripePaymentIntentId: paymentIntentId,
      method: "ONLINE",
      OR: [
        { status: { in: ["PENDING", "FAILED"] } },
        { status: "SUCCEEDED", settledAmount: { not: null } },
      ],
    },
    orderBy: { createdAt: "asc" },
  });
}
