/*
  Warnings:

  - Made the column `specialty` on table `RentalRequest` required. This step will fail if there are existing NULL values in that column.
  - Made the column `vatNumber` on table `Staff` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterEnum
ALTER TYPE "AppointmentStatus" ADD VALUE 'ACCEPTED';

-- AlterTable
ALTER TABLE "RentalRequest" ALTER COLUMN "specialty" SET NOT NULL;

-- AlterTable
ALTER TABLE "Staff" ALTER COLUMN "vatNumber" SET NOT NULL;

-- CreateIndex
CREATE INDEX "Notification_userId_idx" ON "Notification"("userId");

-- CreateIndex
CREATE INDEX "Notification_createdAt_idx" ON "Notification"("createdAt");

-- CreateIndex
CREATE INDEX "Review_userId_idx" ON "Review"("userId");

-- CreateIndex
CREATE INDEX "Transaction_paymentId_idx" ON "Transaction"("paymentId");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE INDEX "User_isActive_isDeleted_idx" ON "User"("isActive", "isDeleted");
