-- A manual invoice's Order (source MANUAL, actions/invoices/manual-invoice.js)
-- carries the same identity as a till sale: the client-generated attempt key
-- (idempotency) and the admin who issued it. The original check only knew
-- ONLINE and POS, so every MANUAL order was rejected.
--
-- Kept apart from 20260921120000_manual_invoices: Postgres refuses to use an
-- enum value in the same transaction that added it.
ALTER TABLE "Order" DROP CONSTRAINT IF EXISTS "Order_pos_identity_check";

ALTER TABLE "Order"
  ADD CONSTRAINT "Order_pos_identity_check"
  CHECK (
    ("source" = 'ONLINE' AND "posAttemptKey" IS NULL)
    OR
    ("source" = 'POS' AND "posAttemptKey" IS NOT NULL AND "createdByStaffId" IS NOT NULL)
    OR
    ("source" = 'MANUAL' AND "posAttemptKey" IS NOT NULL AND "createdByStaffId" IS NOT NULL)
  );
