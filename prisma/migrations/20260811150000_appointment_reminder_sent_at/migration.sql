-- AlterTable
ALTER TABLE "Appointment" ADD COLUMN     "reminder24hSentAt" TIMESTAMP(3);
ALTER TABLE "Appointment" ADD COLUMN     "reminder2hSentAt" TIMESTAMP(3);
