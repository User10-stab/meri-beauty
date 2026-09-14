-- Snapshot of the issueInvoice() payload a deferred invoice was going to use,
-- captured at deferral time so resolving the queue later doesn't have to
-- re-derive customer/lines/VAT policy from possibly-changed source data.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'PendingInvoiceRequest' AND column_name = 'payload'
  ) THEN
    ALTER TABLE "PendingInvoiceRequest" ADD COLUMN "payload" JSONB;
  END IF;
END $$;
