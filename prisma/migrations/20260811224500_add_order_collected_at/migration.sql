-- Real Mondial Relay collection date (staff-confirmed at order close), the
-- legal anchor for the 14-day withdrawal window on shipped orders — see
-- withdrawalWindow() in actions/boutique/returns.js.
ALTER TABLE "Order" ADD COLUMN "collectedAt" TIMESTAMP(3);
