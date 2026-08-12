-- The exception-review flow keeps the appointment and its deposit untouched
-- until an OWNER/ADMIN explicitly approves the request.
CREATE TYPE "AppointmentCancellationRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'APPOINTMENT_CANCELLATION_REQUEST';

CREATE TABLE "AppointmentCancellationRequest" (
    "id" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "requestedByUserId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "AppointmentCancellationRequestStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedAt" TIMESTAMP(3),
    "reviewedByUserId" TEXT,
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppointmentCancellationRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AppointmentCancellationRequest_appointmentId_key" ON "AppointmentCancellationRequest"("appointmentId");
CREATE INDEX "AppointmentCancellationRequest_status_createdAt_idx" ON "AppointmentCancellationRequest"("status", "createdAt");
CREATE INDEX "AppointmentCancellationRequest_requestedByUserId_idx" ON "AppointmentCancellationRequest"("requestedByUserId");
CREATE INDEX "AppointmentCancellationRequest_reviewedByUserId_idx" ON "AppointmentCancellationRequest"("reviewedByUserId");

ALTER TABLE "AppointmentCancellationRequest"
  ADD CONSTRAINT "AppointmentCancellationRequest_appointmentId_fkey"
  FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AppointmentCancellationRequest"
  ADD CONSTRAINT "AppointmentCancellationRequest_requestedByUserId_fkey"
  FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AppointmentCancellationRequest"
  ADD CONSTRAINT "AppointmentCancellationRequest_reviewedByUserId_fkey"
  FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
