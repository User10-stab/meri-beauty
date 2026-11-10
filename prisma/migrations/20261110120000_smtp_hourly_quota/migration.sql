ALTER TYPE "CampaignStatus" ADD VALUE 'FAILED';
ALTER TYPE "CampaignRecipientStatus" ADD VALUE 'SENDING';
ALTER TYPE "CampaignRecipientStatus" ADD VALUE 'UNKNOWN';

ALTER TABLE "Campaign" ADD COLUMN "queuedAt" TIMESTAMP(3),
  ADD COLUMN "leaseUntil" TIMESTAMP(3),
  ADD COLUMN "leaseToken" TEXT,
  ADD COLUMN "proofStartedAt" TIMESTAMP(3);

ALTER TABLE "CampaignRecipient" ADD COLUMN "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

DROP INDEX "CampaignRecipient_campaignId_status_idx";
CREATE INDEX "CampaignRecipient_campaignId_status_nextAttemptAt_idx"
  ON "CampaignRecipient"("campaignId", "status", "nextAttemptAt");

CREATE TABLE "SmtpQuotaReservation" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "expiresAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "SmtpQuotaReservation_expiresAt_idx" ON "SmtpQuotaReservation"("expiresAt");

-- Preserve the existing recipient snapshot, even if the old batch did not
-- get far enough to update the campaign's sentCount.
UPDATE "Campaign" c
SET "queuedAt" = CURRENT_TIMESTAMP,
    "sentCount" = (SELECT count(*) FROM "CampaignRecipient" r WHERE r."campaignId" = c."id" AND r."status" = 'SENT'),
    "totalSenders" = (SELECT count(*) FROM "CampaignRecipient" r WHERE r."campaignId" = c."id"),
    "scheduledDate" = CASE WHEN c."status" = 'SCHEDULED' THEN CURRENT_TIMESTAMP ELSE c."scheduledDate" END
WHERE c."status" IN ('DRAFT', 'SCHEDULED')
  AND EXISTS (SELECT 1 FROM "CampaignRecipient" r WHERE r."campaignId" = c."id");

UPDATE "CampaignRecipient" r SET "status" = 'PENDING'
FROM "Campaign" c
WHERE r."campaignId" = c."id" AND c."status" IN ('DRAFT', 'SCHEDULED')
  AND r."status" = 'FAILED' AND r."attempts" < 3;
