-- AlterTable
ALTER TABLE "formation_reservations" ADD COLUMN     "reminderSentAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "workshop_reservations" ADD COLUMN     "reminderSentAt" TIMESTAMP(3);

