-- TimeOff.isFullDay was added to schema.prisma by the calendar work (commit
-- 13791e8) without an accompanying migration, so `prisma migrate status`
-- reported "up to date" while the column did not exist in the database —
-- getStaffForCalendar() then failed with P2022 at runtime. This is that
-- commit's missing migration.

ALTER TABLE "TimeOff" ADD COLUMN "isFullDay" BOOLEAN NOT NULL DEFAULT false;
