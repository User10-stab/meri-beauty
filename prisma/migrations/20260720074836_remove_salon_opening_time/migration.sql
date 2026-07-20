/*
  Warnings:

  - You are about to drop the column `closingTime` on the `Salon` table. All the data in the column will be lost.
  - You are about to drop the column `openingTime` on the `Salon` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Salon" DROP COLUMN "closingTime",
DROP COLUMN "openingTime";

-- CreateTable
CREATE TABLE "SalonWorkingDay" (
    "id" TEXT NOT NULL,
    "day" "WeekDay" NOT NULL,
    "isOpen" BOOLEAN NOT NULL DEFAULT true,
    "openingTime" TEXT NOT NULL,
    "closingTime" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,

    CONSTRAINT "SalonWorkingDay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalonClosure" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "isFullDay" BOOLEAN NOT NULL DEFAULT true,
    "openingTime" TEXT,
    "closingTime" TEXT,
    "salonId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalonClosure_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SalonWorkingDay_salonId_day_key" ON "SalonWorkingDay"("salonId", "day");

-- AddForeignKey
ALTER TABLE "SalonWorkingDay" ADD CONSTRAINT "SalonWorkingDay_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalonClosure" ADD CONSTRAINT "SalonClosure_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE CASCADE;
