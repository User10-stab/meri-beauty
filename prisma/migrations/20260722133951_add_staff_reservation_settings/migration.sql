-- CreateEnum
CREATE TYPE "ReservationConfirmationMode" AS ENUM ('AUTOMATIC', 'MANUAL');

-- AlterTable
ALTER TABLE "Staff" ADD COLUMN     "depositEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "depositPercentage" DECIMAL(5,2) NOT NULL DEFAULT 10.0,
ADD COLUMN     "reservationConfirmationMode" "ReservationConfirmationMode" NOT NULL DEFAULT 'MANUAL',
ADD COLUMN     "setupCompleted" BOOLEAN NOT NULL DEFAULT false;
