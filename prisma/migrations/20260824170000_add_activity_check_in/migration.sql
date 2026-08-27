-- Check-in tickets for ateliers/événements and formations.
--
-- The QR a customer shows at the door. Deliberately nullable and NOT
-- backfilled: a code is minted only when a reservation reaches CONFIRMED
-- (see lib/activities/check-in-code.js), so its presence is itself the proof
-- that money moved. Reservations confirmed before this migration get their
-- code lazily on the next profile visit rather than in a data migration that
-- could collide on the unique index.

ALTER TABLE "workshop_reservations"
  ADD COLUMN "checkInCode"    TEXT,
  ADD COLUMN "checkedInSeats" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "checkedInAt"    TIMESTAMP(3),
  ADD COLUMN "checkedInById"  TEXT;

ALTER TABLE "formation_reservations"
  ADD COLUMN "checkInCode"    TEXT,
  ADD COLUMN "checkedInSeats" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "checkedInAt"    TIMESTAMP(3),
  ADD COLUMN "checkedInById"  TEXT;

CREATE UNIQUE INDEX "workshop_reservations_checkInCode_key"
  ON "workshop_reservations"("checkInCode");
CREATE UNIQUE INDEX "formation_reservations_checkInCode_key"
  ON "formation_reservations"("checkInCode");

ALTER TABLE "workshop_reservations"
  ADD CONSTRAINT "workshop_reservations_checkedInById_fkey"
  FOREIGN KEY ("checkedInById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "formation_reservations"
  ADD CONSTRAINT "formation_reservations_checkedInById_fkey"
  FOREIGN KEY ("checkedInById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- A scan can never admit more people than the reservation paid for. Enforced
-- in the DB as well as in confirmActivityCheckIn's conditional updateMany:
-- the action guards the race, this guards a bug or a manual UPDATE.
ALTER TABLE "workshop_reservations"
  ADD CONSTRAINT "workshop_reservations_checkedInSeats_within_booking"
  CHECK ("checkedInSeats" >= 0 AND "checkedInSeats" <= "seatsCount");

ALTER TABLE "formation_reservations"
  ADD CONSTRAINT "formation_reservations_checkedInSeats_within_booking"
  CHECK ("checkedInSeats" >= 0 AND "checkedInSeats" <= "seatsCount");
