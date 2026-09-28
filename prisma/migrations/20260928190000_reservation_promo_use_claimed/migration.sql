-- Atelier / formation promo uses: marks the bookings that hold a
-- PromoCode.usedCount use, so a cancellation gives back exactly that use
-- (lib/promo-code-release.js). Until now a cancelled or expired booking never
-- gave its use back.

-- AlterTable
ALTER TABLE "workshop_reservations" ADD COLUMN     "promoUseClaimed" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "formation_reservations" ADD COLUMN     "promoUseClaimed" BOOLEAN NOT NULL DEFAULT false;

-- Backfill: a live booking carrying a code made since these flows started
-- claiming uses (commit 48f4f7ab, 2026-08-11 16:08 Brussels) still holds its
-- use, so its cancellation must give it back. Older bookings never took one
-- (the first promo-code release did not count uses at all) and already
-- cancelled ones already leaked theirs — both stay false, so nothing is given
-- back that was never taken.
UPDATE "workshop_reservations"
SET "promoUseClaimed" = true
WHERE "promoCodeId" IS NOT NULL
  AND "status" <> 'CANCELLED'
  AND "createdAt" >= TIMESTAMP '2026-08-11 15:08:11';

UPDATE "formation_reservations"
SET "promoUseClaimed" = true
WHERE "promoCodeId" IS NOT NULL
  AND "status" <> 'CANCELLED'
  AND "createdAt" >= TIMESTAMP '2026-08-11 15:08:11';
