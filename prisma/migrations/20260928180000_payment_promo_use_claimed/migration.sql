-- Rendez-vous promo uses: marks the appointment payments that took a
-- PromoCode.usedCount use at booking, so a cancellation gives back exactly
-- that use (lib/promo-code-release.js). Existing rows default to false on
-- purpose: appointments booked before 2026-09-28 never took a use, so
-- nothing must be given back for them.
-- Purely additive.

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "promoUseClaimed" BOOLEAN NOT NULL DEFAULT false;
