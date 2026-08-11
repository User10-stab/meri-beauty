-- Purely additive: isCompany defaults to false (existing rows stay "particulier"),
-- termsAcceptedAt/termsAcceptedVersion default to NULL (existing accounts predate
-- this requirement — not retroactively "accepted" anything, left honestly blank).
ALTER TABLE "User" ADD COLUMN "isCompany" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "termsAcceptedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "termsAcceptedVersion" TEXT;
