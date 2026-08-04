/*
  Warnings:

  - A unique constraint covering the columns `[vatNumber]` on the table `Staff` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[stripeAccountId]` on the table `Staff` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "RentalRequest" ADD COLUMN     "specialty" TEXT;

-- AlterTable
ALTER TABLE "Staff" ADD COLUMN     "accountHolderName" TEXT,
ADD COLUMN     "bankName" TEXT,
ADD COLUMN     "bic" TEXT,
ADD COLUMN     "iban" TEXT,
ADD COLUMN     "stripeAccountId" TEXT,
ADD COLUMN     "stripeChargesEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "stripePayoutsEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "vatNumber" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Staff_vatNumber_key" ON "Staff"("vatNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Staff_stripeAccountId_key" ON "Staff"("stripeAccountId");
