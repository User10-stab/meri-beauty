-- AlterEnum: Add 'FAILED' to the "PaymentStatus" enum.
-- The payment_intent.payment_failed webhook handler writes status = "FAILED"
-- (app/api/webhooks/stripe/route.js handlePaymentIntentFailed). Without this
-- value in the enum, Postgres rejects the update, the webhook throws 500, and
-- Stripe retries the failed-payment event forever — leaving the Payment PENDING
-- and the appointment never cancelled.
ALTER TYPE "PaymentStatus" ADD VALUE IF NOT EXISTS 'FAILED';
