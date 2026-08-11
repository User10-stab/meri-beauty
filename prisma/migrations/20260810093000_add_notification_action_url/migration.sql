-- Add Notification.actionUrl column (was added to Prisma schema/code but missing in DB)

ALTER TABLE "Notification"
ADD COLUMN "actionUrl" TEXT;

-- Index not strictly required; actionUrl is not queried by itself.
