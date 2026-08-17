-- Exact amount + stable Stripe idempotency key for the refund operation
-- currently in flight on a Payment. Without this, a retry after a crash or
-- a failed Stripe call has to recompute "what's left refundable" from the
-- Transaction ledger, which resolves to the full outstanding balance
-- whenever no REFUND row was ever written — the very reason the payment is
-- stuck in the first place. See lib/payments/retry-failed-refunds.js.
ALTER TABLE "Payment" ADD COLUMN "pendingRefundAmount" DECIMAL(65,30);
ALTER TABLE "Payment" ADD COLUMN "pendingRefundIdempotencyKey" TEXT;
