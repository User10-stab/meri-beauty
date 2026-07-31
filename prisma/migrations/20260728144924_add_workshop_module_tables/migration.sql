-- CreateEnum
CREATE TYPE "WorkshopType" AS ENUM ('WORKSHOP', 'EVENT');

-- CreateEnum
CREATE TYPE "WorkshopStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'CANCELLED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('SCHEDULED', 'ONGOING', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "WorkshopReservationStatus" AS ENUM ('PENDING_DEPOSIT', 'CONFIRMED', 'CANCELLED', 'COMPLETED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "WaitingListStatus" AS ENUM ('WAITING', 'NOTIFIED', 'EXPIRED', 'CONVERTED', 'REMOVED');

-- CreateTable
CREATE TABLE "workshops" (
    "id" TEXT NOT NULL,
    "type" "WorkshopType" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "cover" TEXT,
    "price" DECIMAL(10,2) NOT NULL,
    "duration" INTEGER NOT NULL,
    "language" TEXT,
    "capacity" INTEGER NOT NULL,
    "animatorId" TEXT,
    "status" "WorkshopStatus" NOT NULL DEFAULT 'DRAFT',
    "allowMultipleSessions" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workshops_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workshop_sessions" (
    "id" TEXT NOT NULL,
    "workshopId" TEXT NOT NULL,
    "animatorId" TEXT,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "capacity" INTEGER NOT NULL,
    "status" "SessionStatus" NOT NULL DEFAULT 'SCHEDULED',
    "registrationDeadline" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workshop_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workshop_reservations" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "paymentId" TEXT,
    "seatsCount" INTEGER NOT NULL DEFAULT 1,
    "status" "WorkshopReservationStatus" NOT NULL DEFAULT 'PENDING_DEPOSIT',
    "holdExpiresAt" TIMESTAMP(3),
    "depositAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "totalPrice" DECIMAL(10,2) NOT NULL,
    "balanceDue" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "participants" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workshop_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "waiting_list_entries" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "seatsRequested" INTEGER NOT NULL DEFAULT 1,
    "position" INTEGER NOT NULL,
    "status" "WaitingListStatus" NOT NULL DEFAULT 'WAITING',
    "notifiedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "convertedToReservationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "waiting_list_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "animators" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "bio" TEXT,
    "avatar" TEXT,
    "website" TEXT,
    "instagram" TEXT,
    "facebook" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "animators_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "workshop_sessions_workshopId_idx" ON "workshop_sessions"("workshopId");

-- CreateIndex
CREATE INDEX "workshop_reservations_sessionId_idx" ON "workshop_reservations"("sessionId");

-- CreateIndex
CREATE INDEX "workshop_reservations_customerId_idx" ON "workshop_reservations"("customerId");

-- CreateIndex
CREATE INDEX "waiting_list_entries_sessionId_position_idx" ON "waiting_list_entries"("sessionId", "position");

-- CreateIndex
CREATE INDEX "waiting_list_entries_sessionId_status_idx" ON "waiting_list_entries"("sessionId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "animators_email_key" ON "animators"("email");

-- AddForeignKey
ALTER TABLE "workshops" ADD CONSTRAINT "workshops_animatorId_fkey" FOREIGN KEY ("animatorId") REFERENCES "animators"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workshop_sessions" ADD CONSTRAINT "workshop_sessions_workshopId_fkey" FOREIGN KEY ("workshopId") REFERENCES "workshops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workshop_sessions" ADD CONSTRAINT "workshop_sessions_animatorId_fkey" FOREIGN KEY ("animatorId") REFERENCES "animators"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workshop_reservations" ADD CONSTRAINT "workshop_reservations_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "workshop_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workshop_reservations" ADD CONSTRAINT "workshop_reservations_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waiting_list_entries" ADD CONSTRAINT "waiting_list_entries_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "workshop_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waiting_list_entries" ADD CONSTRAINT "waiting_list_entries_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
