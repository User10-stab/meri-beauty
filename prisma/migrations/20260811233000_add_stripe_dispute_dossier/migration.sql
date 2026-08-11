-- Persistent dossier for a Stripe dispute/chargeback. Before this, the only
-- record was a best-effort staff alert email — no durable place to track
-- who's handling it, what was submitted, or the eventual outcome.
CREATE TYPE "DisputeStatus" AS ENUM ('NEEDS_RESPONSE', 'UNDER_REVIEW', 'WARNING_NEEDS_RESPONSE', 'WARNING_UNDER_REVIEW', 'WARNING_CLOSED', 'WON', 'LOST', 'CHARGE_REFUNDED');

CREATE TABLE "StripeDispute" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "stripeDisputeId" TEXT NOT NULL,
    "stripeChargeId" TEXT,
    "amount" DECIMAL(65,30) NOT NULL,
    "reason" TEXT,
    "status" "DisputeStatus" NOT NULL DEFAULT 'NEEDS_RESPONSE',
    "dueBy" TIMESTAMP(3),
    "assignedStaffId" TEXT,
    "responseSentAt" TIMESTAMP(3),
    "proofOfShipmentReference" TEXT,
    "conclusion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StripeDispute_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StripeDispute_stripeDisputeId_key" ON "StripeDispute"("stripeDisputeId");

CREATE INDEX "StripeDispute_paymentId_idx" ON "StripeDispute"("paymentId");

CREATE INDEX "StripeDispute_status_idx" ON "StripeDispute"("status");

ALTER TABLE "StripeDispute" ADD CONSTRAINT "StripeDispute_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "StripeDispute" ADD CONSTRAINT "StripeDispute_assignedStaffId_fkey" FOREIGN KEY ("assignedStaffId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
