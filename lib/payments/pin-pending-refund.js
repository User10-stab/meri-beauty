import { randomUUID } from "crypto";

/**
 * Pins the exact refund amount + a stable idempotency key on a Payment
 * before the Stripe call, inside the same transaction that commits the
 * cancellation itself. A crash/timeout mid-call then stays visible to
 * lib/payments/retry-failed-refunds.js instead of silently looking paid
 * forever — retryFailedRefunds hard-requires pendingRefundAmount and never
 * recomputes it from the ledger. Mirrors actions/boutique/returns.js's
 * completeReturnRequest, the one call site that already did this correctly.
 */
export function buildRefundIdempotencyKey(prefix, paymentId) {
  return `${prefix}-${paymentId}-${randomUUID()}`;
}

export function pinPendingRefund(tx, paymentId, amount, idempotencyKey, creditNoteId = null) {
  return tx.payment.update({
    where: { id: paymentId },
    data: {
      status: "REFUND_PENDING",
      refundAttemptedAt: new Date(),
      pendingRefundAmount: amount,
      pendingRefundIdempotencyKey: idempotencyKey,
      // The credit note was already issued, inside the same transaction as
      // this pin, before the Stripe call that can fail or resolve later on
      // retry — pinning its id here is what lets the REFUND Transaction row
      // created once Stripe (or the retry cron) confirms still link back to it.
      pendingRefundCreditNoteId: creditNoteId,
    },
  });
}

/** Leaves pendingRefundAmount/idempotencyKey set so the retry job can replay this exact call. */
export function markRefundFailed(prismaClient, paymentId, error) {
  return prismaClient.payment.update({
    where: { id: paymentId },
    data: {
      status: "REFUND_FAILED",
      refundFailureReason: error?.message?.slice(0, 500) ?? "Erreur inconnue",
      refundAttemptedAt: new Date(),
      refundRetryCount: { increment: 1 },
    },
  });
}

/** Clears the pin once Stripe has actually confirmed the refund. */
export function clearPendingRefund(prismaClient, paymentId, status) {
  return prismaClient.payment.update({
    where: { id: paymentId },
    data: { status, pendingRefundAmount: null, pendingRefundIdempotencyKey: null, pendingRefundCreditNoteId: null },
  });
}
