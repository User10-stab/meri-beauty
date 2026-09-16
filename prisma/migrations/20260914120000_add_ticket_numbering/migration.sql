-- One global, gapless, year-reset ticket sequence shared by every sale type
-- (Order and the reservation/appointment Payment models) — see
-- lib/tickets/allocate-ticket-number.js. Nullable + unique from day one
-- (same pattern as Order.pickupCode / Payment.transactionReference): a
-- Postgres unique index never treats two NULLs as duplicates, so this is
-- safe to add before any row has a value, no deferred second migration
-- needed. Historical rows are backfilled by scripts/backfill-ticket-numbers.mjs
-- AFTER this migration is applied and BEFORE the application code that
-- allocates new numbers is deployed — see that script's own header.

CREATE TYPE "TicketKind" AS ENUM ('ORDER', 'APPOINTMENT', 'WORKSHOP', 'EVENT', 'FORMATION');

ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "ticketNumber" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "ticketKind" "TicketKind" NOT NULL DEFAULT 'ORDER';
CREATE UNIQUE INDEX IF NOT EXISTS "Order_ticketNumber_key" ON "Order"("ticketNumber");

ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "ticketNumber" TEXT;
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "ticketKind" "TicketKind";
CREATE UNIQUE INDEX IF NOT EXISTS "Payment_ticketNumber_key" ON "Payment"("ticketNumber");
CREATE INDEX IF NOT EXISTS "Payment_ticketKind_idx" ON "Payment"("ticketKind");
