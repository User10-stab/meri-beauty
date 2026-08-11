-- Add Notification.isRead column (present in Prisma schema but missing in DB)

ALTER TABLE "Notification"
ADD COLUMN IF NOT EXISTS "isRead" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "Notification_userId_isRead_idx"
ON "Notification"("userId", "isRead");
