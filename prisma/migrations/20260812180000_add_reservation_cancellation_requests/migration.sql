-- Atelier/formation cancellation requests.
--
-- Customers cannot self-cancel either flow by policy (the 50% deposit is
-- non-refundable; exceptions are decided case by case). Until now they saw
-- no way to cancel and no way to ask, so every such case became an
-- untracked phone call. This gives the request a durable home, the same way
-- AppointmentCancellationRequest already does for appointments.

CREATE TYPE "ReservationCancellationRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'RESERVATION_CANCELLATION_REQUEST';

CREATE TABLE "ReservationCancellationRequest" (
  "id" TEXT NOT NULL,
  "workshopReservationId" TEXT,
  "formationReservationId" TEXT,
  "requestedByUserId" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "status" "ReservationCancellationRequestStatus" NOT NULL DEFAULT 'PENDING',
  "reviewedAt" TIMESTAMP(3),
  "reviewedByUserId" TEXT,
  "decisionNote" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ReservationCancellationRequest_pkey" PRIMARY KEY ("id")
);

-- One open request per reservation; also what makes a duplicate submit fail
-- with P2002 instead of silently queueing a second request.
CREATE UNIQUE INDEX "ReservationCancellationRequest_workshopReservationId_key"
  ON "ReservationCancellationRequest"("workshopReservationId");
CREATE UNIQUE INDEX "ReservationCancellationRequest_formationReservationId_key"
  ON "ReservationCancellationRequest"("formationReservationId");

CREATE INDEX "ReservationCancellationRequest_status_createdAt_idx"
  ON "ReservationCancellationRequest"("status", "createdAt");
CREATE INDEX "ReservationCancellationRequest_requestedByUserId_idx"
  ON "ReservationCancellationRequest"("requestedByUserId");
CREATE INDEX "ReservationCancellationRequest_reviewedByUserId_idx"
  ON "ReservationCancellationRequest"("reviewedByUserId");

ALTER TABLE "ReservationCancellationRequest"
  ADD CONSTRAINT "ReservationCancellationRequest_workshopReservationId_fkey"
  FOREIGN KEY ("workshopReservationId") REFERENCES "workshop_reservations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ReservationCancellationRequest"
  ADD CONSTRAINT "ReservationCancellationRequest_formationReservationId_fkey"
  FOREIGN KEY ("formationReservationId") REFERENCES "formation_reservations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ReservationCancellationRequest"
  ADD CONSTRAINT "ReservationCancellationRequest_requestedByUserId_fkey"
  FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ReservationCancellationRequest"
  ADD CONSTRAINT "ReservationCancellationRequest_reviewedByUserId_fkey"
  FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Polymorphic on exactly one source, same approach as Payment_exactly_one_source
-- (Prisma has no schema-level XOR).
ALTER TABLE "ReservationCancellationRequest"
  ADD CONSTRAINT "ReservationCancellationRequest_exactly_one_source"
  CHECK (
    (CASE WHEN "workshopReservationId" IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN "formationReservationId" IS NOT NULL THEN 1 ELSE 0 END) = 1
  );
