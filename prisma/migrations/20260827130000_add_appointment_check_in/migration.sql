-- Check-in ticket for appointments ("R-" prefix), same mechanism as the
-- ateliers/formations one added in 20260824170000_add_activity_check_in.
--
-- Deliberately nullable and NOT backfilled: a code is minted only when an
-- appointment reaches CONFIRMED (see lib/activities/check-in-code.js), so its
-- presence is itself the proof that a deposit or the full price was taken.
-- Appointments confirmed before this migration get their code lazily on the
-- next profile visit or counter scan, same as the existing kinds.
--
-- No "checkedInSeats" counter here: one appointment is always one person, so
-- check-in is a single timestamp instead of an admitted-seats count.

ALTER TABLE "Appointment"
  ADD COLUMN "checkInCode"   TEXT,
  ADD COLUMN "checkedInAt"   TIMESTAMP(3),
  ADD COLUMN "checkedInById" TEXT;

CREATE UNIQUE INDEX "Appointment_checkInCode_key"
  ON "Appointment"("checkInCode");

ALTER TABLE "Appointment"
  ADD CONSTRAINT "Appointment_checkedInById_fkey"
  FOREIGN KEY ("checkedInById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
