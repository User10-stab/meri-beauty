CREATE TABLE "ManualRefundCase" (
    "id" TEXT NOT NULL,
    "stripeCheckoutSessionId" TEXT NOT NULL,
    "stripePaymentIntentId" TEXT NOT NULL,
    "stripeAccountId" TEXT,
    "amount" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'eur',
    "reason" TEXT NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "resolutionReference" TEXT,
    "resolvedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ManualRefundCase_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ManualRefundCase_stripeCheckoutSessionId_key" ON "ManualRefundCase"("stripeCheckoutSessionId");
CREATE UNIQUE INDEX "ManualRefundCase_stripePaymentIntentId_key" ON "ManualRefundCase"("stripePaymentIntentId");
CREATE INDEX "ManualRefundCase_resolvedAt_createdAt_idx" ON "ManualRefundCase"("resolvedAt", "createdAt");

ALTER TABLE "ManualRefundCase" ADD CONSTRAINT "ManualRefundCase_resolvedByUserId_fkey"
  FOREIGN KEY ("resolvedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "RefundLeg" ADD COLUMN "stripeRefundIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- Existing legs already store their observed refund in the legacy scalar
-- column. Seed the new replay-safe history before any later refund can
-- replace that scalar value.
UPDATE "RefundLeg"
SET "stripeRefundIds" = ARRAY["stripeRefundId"]::TEXT[]
WHERE "stripeRefundId" IS NOT NULL;
