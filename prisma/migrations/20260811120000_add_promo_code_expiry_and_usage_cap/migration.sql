-- Purely additive: expiresAt/maxUses default to NULL (unlimited/never-expires,
-- same behavior as before this migration), usedCount defaults to 0.
ALTER TABLE "PromoCode" ADD COLUMN "expiresAt" TIMESTAMP(3);
ALTER TABLE "PromoCode" ADD COLUMN "maxUses" INTEGER;
ALTER TABLE "PromoCode" ADD COLUMN "usedCount" INTEGER NOT NULL DEFAULT 0;
