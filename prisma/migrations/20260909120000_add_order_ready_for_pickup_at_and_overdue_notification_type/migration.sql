-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'ORDER_FULFILMENT_OVERDUE';

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "readyForPickupAt" TIMESTAMP(3);
