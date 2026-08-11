-- Reconstructed placeholder, 2026-08-10.
--
-- This migration name was already recorded as applied in the shared Neon
-- dev DB's `_prisma_migrations` history table, but the migration folder
-- itself was never committed to git (applied directly against the DB by
-- whoever did the charifa-dev Stripe Connect reconciliation on 2026-08-06,
-- without running `prisma migrate dev`/committing the result). `prisma
-- migrate dev` detected this as drift and offered `migrate migrate reset`
-- (which would drop the shared dev DB) as its fix -- do not run that.
--
-- This file only needs to exist so local migration history matches the
-- DB's history table; it is registered as already-applied and Prisma will
-- never execute it. Content below is the one piece of concrete drift
-- Prisma's diff could still identify at reconciliation time (2026-08-10);
-- any other schema changes bundled into the original untracked apply are
-- otherwise already correctly reflected by later, properly-committed
-- migrations and are not knowable from here.

ALTER TABLE "formations" ALTER COLUMN "depositPercentage" SET DEFAULT 50;
