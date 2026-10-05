-- Columns for the Instagram token refresh flow (ea9657e), which changed
-- schema.prisma without a migration. Already added by hand on prod on
-- 2026-10-05 to restore booking, hence IF NOT EXISTS.
ALTER TABLE "Salon"
  ADD COLUMN IF NOT EXISTS "instagramAccessToken" TEXT,
  ADD COLUMN IF NOT EXISTS "instagramRefreshToken" TEXT,
  ADD COLUMN IF NOT EXISTS "instagramTokenExpiresAt" TIMESTAMP(3);
