-- Session invalidation support: bumped on password change so the JWT
-- session callback can detect and force-expire sessions issued before it.
ALTER TABLE "User" ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 0;
