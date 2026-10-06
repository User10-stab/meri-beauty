-- AlterTable
ALTER TABLE "Appointment" ADD COLUMN IF NOT EXISTS "reviewRequestedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Salon" ADD COLUMN IF NOT EXISTS "instagramAccessToken" TEXT,
ADD COLUMN IF NOT EXISTS "instagramRefreshToken" TEXT,
ADD COLUMN IF NOT EXISTS "instagramTokenExpiresAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "workshop_reservations" ADD COLUMN IF NOT EXISTS "reviewRequestedAt" TIMESTAMP(3);
