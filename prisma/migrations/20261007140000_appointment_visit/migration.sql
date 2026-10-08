-- Several prestations booked together for one client are one visit.
-- Each prestation stays its own Appointment; the visit ties them together.
CREATE TABLE IF NOT EXISTS "AppointmentVisit" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AppointmentVisit_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Appointment" ADD COLUMN IF NOT EXISTS "visitId" TEXT;
-- A prestation cashed together with another one of the same visit and staff
-- member points at the Payment that settled it (one operation, one ticket).
ALTER TABLE "Appointment" ADD COLUMN IF NOT EXISTS "coveredByPaymentId" TEXT;

CREATE INDEX IF NOT EXISTS "Appointment_visitId_idx" ON "Appointment"("visitId");
CREATE INDEX IF NOT EXISTS "Appointment_coveredByPaymentId_idx" ON "Appointment"("coveredByPaymentId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Appointment_visitId_fkey') THEN
    ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_visitId_fkey"
      FOREIGN KEY ("visitId") REFERENCES "AppointmentVisit"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Appointment_coveredByPaymentId_fkey') THEN
    ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_coveredByPaymentId_fkey"
      FOREIGN KEY ("coveredByPaymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
