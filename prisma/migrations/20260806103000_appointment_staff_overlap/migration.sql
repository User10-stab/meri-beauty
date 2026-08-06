-- The Appointment_no_overlap exclusion constraint (see migration
-- 20260804090000_appointment_no_overlap) was keyed on "staffServiceId", not
-- the staff member. A staff member who offers more than one StaffService
-- (e.g. "Manicure" and "Pedicure") was NOT protected by it against being
-- double-booked across two different services at the same time — only two
-- appointments for the SAME staffServiceId collided.
--
-- Fix: denormalize staffId onto Appointment (set at creation time from
-- staffService.staffId, same pattern as other denormalized snapshot columns
-- in this schema) and re-key the exclusion constraint on it directly.

-- 1. Add the column, nullable first so existing rows can be backfilled.
ALTER TABLE "Appointment" ADD COLUMN "staffId" TEXT;

-- 2. Backfill from the StaffService each existing appointment points to.
UPDATE "Appointment" a
SET "staffId" = ss."staffId"
FROM "StaffService" ss
WHERE ss.id = a."staffServiceId";

-- 3. Every appointment has a StaffService, so the backfill above is total —
-- safe to enforce NOT NULL from here on.
ALTER TABLE "Appointment" ALTER COLUMN "staffId" SET NOT NULL;

-- 4. FK + index, matching the conventions already used for staffServiceId.
ALTER TABLE "Appointment"
  ADD CONSTRAINT "Appointment_staffId_fkey"
  FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "Appointment_staffId_startTime_idx" ON "Appointment"("staffId", "startTime");

-- 5. Replace the exclusion constraint: same shape as before, keyed on
-- staffId instead of staffServiceId.
ALTER TABLE "Appointment" DROP CONSTRAINT "Appointment_no_overlap";

ALTER TABLE "Appointment"
  ADD CONSTRAINT "Appointment_no_overlap"
  EXCLUDE USING gist (
    "staffId" WITH =,
    tsrange("startTime", "endTime") WITH &&
  )
  WHERE ("isDeleted" = false AND "status" IN ('PENDING', 'CONFIRMED'));
