-- Marketing Campaign + Prospect Tracking (dashboard admin).
-- Contexte métier salon (RDV, boutique, ateliers, formations) : voir le
-- commentaire "MARKETING" dans schema.prisma. N'écrase rien d'existant
-- (Newsletter / NewsletterRecipient restent intacts).

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'SENT', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ProspectSource" AS ENUM ('google', 'google_ads', 'linkedin', 'facebook', 'instagram', 'email', 'campagne', 'salon_evenement', 'recommandation', 'site_web', 'reservation', 'boutique', 'atelier', 'formation', 'contact', 'autre');

-- CreateEnum
CREATE TYPE "ProspectStatus" AS ENUM ('nouveau', 'contacte', 'engage', 'interesse', 'demo_essai', 'client', 'perdu');

-- CreateEnum
CREATE TYPE "ProspectActivityType" AS ENUM ('prospect_created', 'email_sent', 'email_delivered', 'email_opened', 'email_clicked', 'campaign_sent', 'registration', 'appointment_booked', 'appointment_completed', 'order_placed', 'workshop_booked', 'formation_booked', 'contact_message', 'newsletter_subscribed', 'newsletter_unsubscribed', 'rental_request', 'status_changed', 'note_added', 'manual_contact', 'call', 'other');

-- CreateEnum
CREATE TYPE "NextActionType" AS ENUM ('envoyer_email', 'relancer_email', 'appeler', 'envoyer_campagne', 'proposer_demo', 'suivre_essai', 'autre', 'aucune');

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "preheader" TEXT,
    "content" TEXT NOT NULL,
    "imageUrl" TEXT,
    "attachmentUrl" TEXT,
    "targetSegment" TEXT NOT NULL DEFAULT 'newsletter',
    "ctaText" TEXT,
    "ctaUrl" TEXT,
    "utmSource" TEXT NOT NULL DEFAULT 'email',
    "utmMedium" TEXT NOT NULL DEFAULT 'email',
    "utmCampaign" TEXT,
    "utmContent" TEXT,
    "utmTerm" TEXT,
    "totalSenders" INTEGER NOT NULL DEFAULT 0,
    "openedCount" INTEGER NOT NULL DEFAULT 0,
    "clickedCount" INTEGER NOT NULL DEFAULT 0,
    "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "scheduledDate" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Prospect" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "phone" TEXT,
    "company" TEXT,
    "country" TEXT DEFAULT 'BE',
    "source" "ProspectSource" NOT NULL DEFAULT 'autre',
    "utmSource" TEXT,
    "utmMedium" TEXT,
    "utmCampaign" TEXT,
    "utmContent" TEXT,
    "utmTerm" TEXT,
    "status" "ProspectStatus" NOT NULL DEFAULT 'nouveau',
    "statusHistory" JSONB NOT NULL DEFAULT '[]',
    "userId" TEXT,
    "lastActivityAt" TIMESTAMP(3),
    "lastEventType" TEXT,
    "lastCampaignId" TEXT,
    "nextActionType" "NextActionType",
    "nextActionDueDate" TIMESTAMP(3),
    "nextActionNote" TEXT,
    "marketingOptOut" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Prospect_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProspectActivity" (
    "id" TEXT NOT NULL,
    "prospectId" TEXT NOT NULL,
    "type" "ProspectActivityType" NOT NULL,
    "campaignId" TEXT,
    "refId" TEXT,
    "refModel" TEXT,
    "metadata" JSONB,
    "description" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProspectActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignClick" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "userId" TEXT,
    "email" TEXT,
    "ctaUrl" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "referer" TEXT,
    "clickedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampaignClick_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MailOpening" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT,
    "userId" TEXT,
    "email" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MailOpening_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Prospect_email_key" ON "Prospect"("email");

-- CreateIndex
CREATE INDEX "Campaign_status_scheduledDate_idx" ON "Campaign"("status", "scheduledDate");

-- CreateIndex
CREATE INDEX "Prospect_status_createdAt_idx" ON "Prospect"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Prospect_lastActivityAt_idx" ON "Prospect"("lastActivityAt");

-- CreateIndex
CREATE INDEX "Prospect_source_idx" ON "Prospect"("source");

-- CreateIndex
CREATE INDEX "ProspectActivity_prospectId_createdAt_idx" ON "ProspectActivity"("prospectId", "createdAt");

-- CreateIndex
CREATE INDEX "ProspectActivity_campaignId_idx" ON "ProspectActivity"("campaignId");

-- CreateIndex
CREATE INDEX "CampaignClick_campaignId_clickedAt_idx" ON "CampaignClick"("campaignId", "clickedAt");

-- CreateIndex
CREATE INDEX "CampaignClick_email_idx" ON "CampaignClick"("email");

-- CreateIndex
CREATE INDEX "MailOpening_campaignId_openedAt_idx" ON "MailOpening"("campaignId", "openedAt");

-- CreateIndex
CREATE INDEX "MailOpening_email_idx" ON "MailOpening"("email");

-- AddForeignKey
ALTER TABLE "Prospect" ADD CONSTRAINT "Prospect_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prospect" ADD CONSTRAINT "Prospect_lastCampaignId_fkey" FOREIGN KEY ("lastCampaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProspectActivity" ADD CONSTRAINT "ProspectActivity_prospectId_fkey" FOREIGN KEY ("prospectId") REFERENCES "Prospect"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProspectActivity" ADD CONSTRAINT "ProspectActivity_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProspectActivity" ADD CONSTRAINT "ProspectActivity_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignClick" ADD CONSTRAINT "CampaignClick_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MailOpening" ADD CONSTRAINT "MailOpening_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;
