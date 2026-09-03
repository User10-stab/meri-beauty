-- A completed booking can receive an audited financial correction without
-- reopening, cancelling, or otherwise rewriting its historical status.
ALTER TYPE "RefundTrigger" ADD VALUE IF NOT EXISTS 'FINANCIAL_CORRECTION';
ALTER TYPE "RefundTrigger" ADD VALUE IF NOT EXISTS 'CUSTOMER_SELF_CANCELLATION';
