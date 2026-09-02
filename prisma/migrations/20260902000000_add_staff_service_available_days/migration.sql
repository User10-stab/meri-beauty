-- AlterTable
ALTER TABLE "StaffService" ADD COLUMN "availableDays" "WeekDay"[] NOT NULL DEFAULT ARRAY[]::"WeekDay"[];
