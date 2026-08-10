-- Demonstrable, timestamped newsletter/marketing consent (GDPR/ePrivacy) --
-- purely additive, all nullable, no data migration needed.

ALTER TABLE "User" ADD COLUMN "newsletterConsentedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "newsletterConsentSource" TEXT;
ALTER TABLE "User" ADD COLUMN "newsletterConsentVersion" TEXT;
