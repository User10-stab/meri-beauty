-- CreateEnum
CREATE TYPE "StaffRythme" AS ENUM ('1 jour par semaine', '2 jours par semaine', '3 jours par semaine', 'Toute la semaine');

-- AlterTable: Add rythme column to Staff
ALTER TABLE "Staff" ADD COLUMN "rythme" "StaffRythme";
