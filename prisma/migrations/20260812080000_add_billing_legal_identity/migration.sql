-- CreateEnum
CREATE TYPE "InvoiceCustomerType" AS ENUM ('B2C', 'B2B');

-- AlterTable: Salon structured legal identity (required before issueInvoice
-- will emit anything — see lib/invoicing.js's seller-data gate)
ALTER TABLE "Salon" ADD COLUMN "legalName" TEXT;
ALTER TABLE "Salon" ADD COLUMN "companyRegistrationNo" TEXT;
ALTER TABLE "Salon" ADD COLUMN "addressLine1" TEXT;
ALTER TABLE "Salon" ADD COLUMN "addressLine2" TEXT;
ALTER TABLE "Salon" ADD COLUMN "postalCode" TEXT;
ALTER TABLE "Salon" ADD COLUMN "city" TEXT;
ALTER TABLE "Salon" ADD COLUMN "countryCode" TEXT DEFAULT 'BE';

-- Backfill from the already-known real values (visible on invoices already
-- issued from the freeform address/vatNumber fields) so this gate doesn't
-- block sales the moment it goes live. Guarded on the exact known VAT
-- number so this is a no-op anywhere that value doesn't already match.
UPDATE "Salon"
SET "legalName" = "name",
    "companyRegistrationNo" = '0751.854.027',
    "addressLine1" = 'Rue Bonaventure 113',
    "postalCode" = '1090',
    "city" = 'Jette',
    "countryCode" = 'BE'
WHERE "id" = 'main-salon' AND "vatNumber" = 'BE0751.854.027';

-- CreateTable
CREATE TABLE "BillingProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "companyLegalName" TEXT NOT NULL,
    "companyRegistrationNo" TEXT,
    "companyLegalForm" TEXT,
    "billingContactName" TEXT,
    "purchaseOrderReference" TEXT,
    "peppolParticipantId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillingProfile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BillingProfile_userId_key" ON "BillingProfile"("userId");

-- AddForeignKey
ALTER TABLE "BillingProfile" ADD CONSTRAINT "BillingProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable: Invoice B2B snapshot fields
ALTER TABLE "Invoice" ADD COLUMN "customerType" "InvoiceCustomerType" NOT NULL DEFAULT 'B2C';
ALTER TABLE "Invoice" ADD COLUMN "customerLegalName" TEXT;
ALTER TABLE "Invoice" ADD COLUMN "customerContactName" TEXT;
ALTER TABLE "Invoice" ADD COLUMN "customerRegistrationNo" TEXT;
ALTER TABLE "Invoice" ADD COLUMN "purchaseOrderReference" TEXT;
