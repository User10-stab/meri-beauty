-- AlterTable: Replace endDate (DateTime?) with desiredPace (String?) on RentalRequest
ALTER TABLE "RentalRequest" ADD COLUMN "desiredPace" TEXT;
UPDATE "RentalRequest" SET "desiredPace" = NULL;
ALTER TABLE "RentalRequest" DROP COLUMN "endDate";
