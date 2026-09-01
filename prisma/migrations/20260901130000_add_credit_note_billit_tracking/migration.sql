-- Add Billit/Peppol send tracking to CreditNote, mirroring Invoice.billitOrderId/billitSentAt
ALTER TABLE "CreditNote" ADD COLUMN IF NOT EXISTS "billitOrderId" TEXT;
ALTER TABLE "CreditNote" ADD COLUMN IF NOT EXISTS "billitSentAt" TIMESTAMP(3);
