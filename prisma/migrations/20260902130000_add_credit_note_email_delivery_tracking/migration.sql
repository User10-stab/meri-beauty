-- Records a confirmed direct e-mail send for an issued credit note.
-- Kept separate from billitSentAt: Billit order creation is not final Peppol
-- delivery confirmation.
ALTER TABLE "CreditNote" ADD COLUMN IF NOT EXISTS "emailSentAt" TIMESTAMP(3);
