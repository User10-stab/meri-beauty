-- Records a confirmed direct e-mail send for the Operations delivery status.
-- This is intentionally separate from billitSentAt, which only means the
-- invoice was created in Billit and not that Peppol delivery completed.
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "emailSentAt" TIMESTAMP(3);
