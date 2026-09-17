-- A pay-on-site pickup taken over by the till (« Encaisser ») used to be
-- closed as CANCELLED with the reason "Encaissée en caisse — vente n°X",
-- which read like a cancellation. It gets its own status and a real link to
-- the counter sale that replaced it.
--
-- The new enum value is added in its own migration: Postgres refuses to use
-- a value added in the same transaction, and the backfill that uses it is
-- the next migration.
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'SETTLED_AT_COUNTER';

ALTER TABLE "Order" ADD COLUMN "settledBySaleId" TEXT;

CREATE UNIQUE INDEX "Order_settledBySaleId_key" ON "Order"("settledBySaleId");

ALTER TABLE "Order" ADD CONSTRAINT "Order_settledBySaleId_fkey" FOREIGN KEY ("settledBySaleId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;
