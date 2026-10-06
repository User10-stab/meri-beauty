-- AlterTable
ALTER TABLE "Appointment" ADD COLUMN     "reviewRequestedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Salon" ADD COLUMN     "instagramAccessToken" TEXT,
ADD COLUMN     "instagramRefreshToken" TEXT,
ADD COLUMN     "instagramTokenExpiresAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "workshop_reservations" ADD COLUMN     "reviewRequestedAt" TIMESTAMP(3);
