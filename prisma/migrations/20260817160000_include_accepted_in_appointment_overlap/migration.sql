-- ACCEPTED appointments are approved by staff and awaiting the customer's
-- payment choice. They must continue occupying capacity just like PENDING and
-- CONFIRMED appointments, including at the database concurrency boundary.
ALTER TABLE "Appointment" DROP CONSTRAINT IF EXISTS "Appointment_no_overlap";

ALTER TABLE "Appointment"
  ADD CONSTRAINT "Appointment_no_overlap"
  EXCLUDE USING gist (
    "staffId" WITH =,
    tsrange("startTime", "endTime") WITH &&
  )
  WHERE ("isDeleted" = false AND "status" IN ('PENDING', 'ACCEPTED', 'CONFIRMED'));
