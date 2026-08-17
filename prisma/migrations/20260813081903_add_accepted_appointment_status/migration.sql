-- ACCEPTED may already exist on shared databases where the enum was added
-- manually before migration history was reconciled. Keep this migration safe
-- to deploy and aligned with schema.prisma: RentalRequest.specialty and
-- Staff.vatNumber intentionally remain nullable.
ALTER TYPE "AppointmentStatus" ADD VALUE IF NOT EXISTS 'ACCEPTED';

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Notification_userId_idx" ON "Notification"("userId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Notification_createdAt_idx" ON "Notification"("createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Review_userId_idx" ON "Review"("userId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Transaction_paymentId_idx" ON "Transaction"("paymentId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "User_isActive_isDeleted_idx" ON "User"("isActive", "isDeleted");
