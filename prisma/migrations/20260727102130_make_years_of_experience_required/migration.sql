/*
  Warnings:

  - Made the column `yearsOfExperience` on table `Staff` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "Staff" ALTER COLUMN "yearsOfExperience" SET NOT NULL;
