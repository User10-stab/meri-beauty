-- Purely additive: all nullable (existing accounts predate this requirement
-- and have no value here), addressCountry defaults to Belgium since new
-- registrations always send it going forward.
ALTER TABLE "User" ADD COLUMN "addressLine1" TEXT;
ALTER TABLE "User" ADD COLUMN "addressLine2" TEXT;
ALTER TABLE "User" ADD COLUMN "addressCity" TEXT;
ALTER TABLE "User" ADD COLUMN "addressPostalCode" TEXT;
ALTER TABLE "User" ADD COLUMN "addressCountry" TEXT DEFAULT 'BE';
