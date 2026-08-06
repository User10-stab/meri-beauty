-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "pickupPointAddress" TEXT,
ADD COLUMN     "pickupPointCity" TEXT,
ADD COLUMN     "pickupPointId" TEXT,
ADD COLUMN     "pickupPointName" TEXT,
ADD COLUMN     "pickupPointPostalCode" TEXT,
ADD COLUMN     "shippingCarrier" TEXT DEFAULT 'MONDIAL_RELAY',
ADD COLUMN     "trackingCode" TEXT;
