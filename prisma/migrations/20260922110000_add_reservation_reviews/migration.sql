-- Make Review polymorphic across appointment / workshop / formation
-- reservations, same pattern as Payment_exactly_one_source.

-- DropForeignKey
ALTER TABLE "Review" DROP CONSTRAINT "Review_appointmentId_fkey";

-- AlterTable
ALTER TABLE "Review" ADD COLUMN     "formationReservationId" TEXT,
ADD COLUMN     "workshopReservationId" TEXT,
ALTER COLUMN "appointmentId" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Review_workshopReservationId_key" ON "Review"("workshopReservationId");

-- CreateIndex
CREATE UNIQUE INDEX "Review_formationReservationId_key" ON "Review"("formationReservationId");

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_workshopReservationId_fkey" FOREIGN KEY ("workshopReservationId") REFERENCES "workshop_reservations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_formationReservationId_fkey" FOREIGN KEY ("formationReservationId") REFERENCES "formation_reservations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Polymorphic guard: exactly one of the three sources is set, same approach
-- as Payment_exactly_one_source (Prisma has no schema-level XOR).
ALTER TABLE "Review"
  ADD CONSTRAINT "Review_exactly_one_source"
  CHECK (
    (CASE WHEN "appointmentId" IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN "workshopReservationId" IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN "formationReservationId" IS NOT NULL THEN 1 ELSE 0 END) = 1
  );
