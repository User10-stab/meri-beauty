-- Expired on-site pickups no longer auto-restock. The reservation is held
-- until a human confirms the customer never collected, because the cron
-- cannot distinguish "never handed over" from "handed over and nobody
-- clicked retrait terminé" — and the second one silently makes an item that
-- already left the salon sellable again.
ALTER TABLE "Order" ADD COLUMN "stockReleasedAt" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN "stockReleasedByUserId" TEXT;

ALTER TABLE "Order" ADD CONSTRAINT "Order_stockReleasedByUserId_fkey"
  FOREIGN KEY ("stockReleasedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Orders that expired under the old automatic behaviour already had their
-- stock returned. Backfilling them keeps them out of the new "retraits à
-- vérifier" worklist, which is for undecided cases only, and makes the
-- release idempotency guard true for historical rows as well.
UPDATE "Order"
SET "stockReleasedAt" = COALESCE("cancelledAt", "updatedAt")
WHERE "status" = 'EXPIRED' AND "stockReleasedAt" IS NULL;

-- The worklist query: expired on-site pickups still holding their stock.
CREATE INDEX "Order_stockReleasedAt_idx" ON "Order"("stockReleasedAt");
