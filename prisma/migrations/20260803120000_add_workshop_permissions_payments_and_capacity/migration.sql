-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "workshopReservationId" TEXT;

-- AlterTable
ALTER TABLE "workshop_reservations" DROP COLUMN "paymentId",
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "cancelledByUserId" TEXT,
ADD COLUMN     "changeFeeAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
ADD COLUMN     "previousSessionId" TEXT;

-- AlterTable
ALTER TABLE "workshop_sessions" ADD COLUMN     "lowSeatsNotifiedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "workshops" ADD COLUMN     "createdById" TEXT,
ALTER COLUMN "depositPercentage" SET DEFAULT 50;

-- CreateIndex
CREATE UNIQUE INDEX "Payment_workshopReservationId_key" ON "Payment"("workshopReservationId");

-- AddForeignKey
ALTER TABLE "workshops" ADD CONSTRAINT "workshops_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workshop_reservations" ADD CONSTRAINT "workshop_reservations_previousSessionId_fkey" FOREIGN KEY ("previousSessionId") REFERENCES "workshop_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workshop_reservations" ADD CONSTRAINT "workshop_reservations_cancelledByUserId_fkey" FOREIGN KEY ("cancelledByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_workshopReservationId_fkey" FOREIGN KEY ("workshopReservationId") REFERENCES "workshop_reservations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Payment used to be a 2-way XOR (appointment vs order). Extend it to a
-- 3-way "exactly one source" check now that workshop reservations can also
-- own a Payment row, per the schema comment anticipating this exact change.
ALTER TABLE "Payment" DROP CONSTRAINT IF EXISTS "Payment_appointment_xor_order";
ALTER TABLE "Payment"
  ADD CONSTRAINT "Payment_exactly_one_source"
  CHECK (
    (CASE WHEN "appointmentId" IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN "orderId" IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN "workshopReservationId" IS NOT NULL THEN 1 ELSE 0 END) = 1
  );

-- Defense-in-depth: max capacity of 8 people per atelier/event, enforced at
-- the DB level in addition to the Zod validation in actions/workshops/.
ALTER TABLE "workshops" ADD CONSTRAINT "workshops_capacity_max8" CHECK ("capacity" <= 8);
ALTER TABLE "workshop_sessions" ADD CONSTRAINT "workshop_sessions_capacity_max8" CHECK ("capacity" <= 8);
