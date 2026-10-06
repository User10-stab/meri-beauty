-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "reviewRequestedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "formation_reservations" ADD COLUMN     "reviewRequestedAt" TIMESTAMP(3);
