-- Appointment cancellation provenance.
CREATE TYPE "AppointmentCancellationSource" AS ENUM (
  'CUSTOMER',
  'STAFF',
  'ADMIN',
  'STRIPE',
  'REFUND_RECONCILIATION',
  'SYSTEM'
);

ALTER TABLE "Appointment"
  ADD COLUMN "cancelledAt" TIMESTAMP(3),
  ADD COLUMN "cancelledByUserId" TEXT,
  ADD COLUMN "cancellationReason" TEXT,
  ADD COLUMN "cancellationSource" "AppointmentCancellationSource";

CREATE INDEX "Appointment_cancelledByUserId_idx"
  ON "Appointment"("cancelledByUserId");

ALTER TABLE "Appointment"
  ADD CONSTRAINT "Appointment_cancelledByUserId_fkey"
  FOREIGN KEY ("cancelledByUserId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- A converted rental request points to exactly one resulting contract, and a
-- contract cannot fulfil more than one request.
ALTER TABLE "RentalRequest" ADD COLUMN "contractId" TEXT;

CREATE UNIQUE INDEX "RentalRequest_contractId_key"
  ON "RentalRequest"("contractId");

ALTER TABLE "RentalRequest"
  ADD CONSTRAINT "RentalRequest_contractId_fkey"
  FOREIGN KEY ("contractId") REFERENCES "Contract"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Fail visibly instead of choosing an arbitrary row if legacy data already
-- violates the singleton assumption. Resolve that data before redeploying.
DO $$
BEGIN
  IF (SELECT COUNT(*) FROM "Salon") > 1 THEN
    RAISE EXCEPTION 'Salon singleton migration refused: more than one Salon row exists';
  END IF;

  IF EXISTS (SELECT 1 FROM "Salon" WHERE "id" <> 'main-salon') THEN
    RAISE EXCEPTION 'Salon singleton migration refused: existing Salon id is not main-salon';
  END IF;
END $$;

ALTER TABLE "Salon" ALTER COLUMN "id" SET DEFAULT 'main-salon';
ALTER TABLE "Salon"
  ADD CONSTRAINT "Salon_singleton_id_check" CHECK ("id" = 'main-salon');
