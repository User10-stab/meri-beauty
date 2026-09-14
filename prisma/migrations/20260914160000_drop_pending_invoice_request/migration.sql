-- Reverts the deferred-invoice queue: a non-privileged staff member's sale
-- that would need an Invoice now simply never gets one, with no follow-up
-- record — no admin resolution queue needed. Transaction.recordedById (added
-- in the same original migration as this table) is unaffected and stays.
DROP TABLE IF EXISTS "PendingInvoiceRequest" CASCADE;
