-- AlterTable
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "reviewRequestedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "formation_reservations" ADD COLUMN IF NOT EXISTS "reviewRequestedAt" TIMESTAMP(3);
