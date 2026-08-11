CREATE TYPE "OrderSource" AS ENUM ('ONLINE', 'POS');

ALTER TABLE "Order"
  ADD COLUMN "source" "OrderSource" NOT NULL DEFAULT 'ONLINE',
  ADD COLUMN "createdByStaffId" TEXT,
  ADD COLUMN "posAttemptKey" TEXT;

CREATE UNIQUE INDEX "Order_posAttemptKey_key" ON "Order"("posAttemptKey");
CREATE INDEX "Order_source_status_createdAt_idx" ON "Order"("source", "status", "createdAt");
CREATE INDEX "Order_createdByStaffId_createdAt_idx" ON "Order"("createdByStaffId", "createdAt");

ALTER TABLE "Order"
  ADD CONSTRAINT "Order_createdByStaffId_fkey"
  FOREIGN KEY ("createdByStaffId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- POS attempt keys are never valid on online orders, and every POS order must
-- retain the staff actor who initiated it.
ALTER TABLE "Order"
  ADD CONSTRAINT "Order_pos_identity_check"
  CHECK (
    ("source" = 'ONLINE' AND "posAttemptKey" IS NULL)
    OR
    ("source" = 'POS' AND "posAttemptKey" IS NOT NULL AND "createdByStaffId" IS NOT NULL)
  );
