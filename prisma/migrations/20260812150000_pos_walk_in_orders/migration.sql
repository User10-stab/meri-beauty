-- Anonymous POS "client de passage" sales create no User row — see
-- completePointOfSaleSale's isWalkIn branch. No backfill needed: every
-- existing row already has a userId.
ALTER TABLE "Order" ALTER COLUMN "userId" DROP NOT NULL;
