-- CreateEnum
CREATE TYPE "FormationType" AS ENUM ('PRIVATE', 'PUBLIC');

-- CreateEnum
CREATE TYPE "FormationStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'CANCELLED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "FormationReservationStatus" AS ENUM ('PENDING_DEPOSIT', 'CONFIRMED', 'CANCELLED', 'COMPLETED', 'NO_SHOW');

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "formationReservationId" TEXT;

-- CreateTable
CREATE TABLE "formations" (
    "id" TEXT NOT NULL,
    "type" "FormationType" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "cover" TEXT,
    "price" DECIMAL(10,2) NOT NULL,
    "duration" INTEGER NOT NULL,
    "language" TEXT,
    "capacity" INTEGER NOT NULL,
    "animatorId" TEXT,
    "status" "FormationStatus" NOT NULL DEFAULT 'DRAFT',
    "allowMultipleSessions" BOOLEAN NOT NULL DEFAULT false,
    "depositPercentage" INTEGER NOT NULL DEFAULT 30,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "formations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "formation_sessions" (
    "id" TEXT NOT NULL,
    "formationId" TEXT NOT NULL,
    "animatorId" TEXT,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "capacity" INTEGER NOT NULL,
    "status" "SessionStatus" NOT NULL DEFAULT 'SCHEDULED',
    "registrationDeadline" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "formation_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "formation_reservations" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "seatsCount" INTEGER NOT NULL DEFAULT 1,
    "status" "FormationReservationStatus" NOT NULL DEFAULT 'PENDING_DEPOSIT',
    "holdExpiresAt" TIMESTAMP(3),
    "depositAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "totalPrice" DECIMAL(10,2) NOT NULL,
    "balanceDue" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "participants" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "formation_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "formation_sessions_formationId_idx" ON "formation_sessions"("formationId");

-- CreateIndex
CREATE INDEX "formation_reservations_sessionId_idx" ON "formation_reservations"("sessionId");

-- CreateIndex
CREATE INDEX "formation_reservations_customerId_idx" ON "formation_reservations"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_formationReservationId_key" ON "Payment"("formationReservationId");

-- AddForeignKey
ALTER TABLE "formations" ADD CONSTRAINT "formations_animatorId_fkey" FOREIGN KEY ("animatorId") REFERENCES "animators"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "formations" ADD CONSTRAINT "formations_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "formation_sessions" ADD CONSTRAINT "formation_sessions_formationId_fkey" FOREIGN KEY ("formationId") REFERENCES "formations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "formation_sessions" ADD CONSTRAINT "formation_sessions_animatorId_fkey" FOREIGN KEY ("animatorId") REFERENCES "animators"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "formation_reservations" ADD CONSTRAINT "formation_reservations_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "formation_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "formation_reservations" ADD CONSTRAINT "formation_reservations_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_formationReservationId_fkey" FOREIGN KEY ("formationReservationId") REFERENCES "formation_reservations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Extend the polymorphic Payment source check from 3-way (appointment/order/
-- workshopReservation) to 4-way, now that a Payment can also belong to a
-- FormationReservation.
ALTER TABLE "Payment" DROP CONSTRAINT IF EXISTS "Payment_exactly_one_source";
ALTER TABLE "Payment"
  ADD CONSTRAINT "Payment_exactly_one_source"
  CHECK (
    (CASE WHEN "appointmentId" IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN "orderId" IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN "workshopReservationId" IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN "formationReservationId" IS NOT NULL THEN 1 ELSE 0 END) = 1
  );
