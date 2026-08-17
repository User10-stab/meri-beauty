CREATE TYPE "VatTreatment" AS ENUM ('DOMESTIC', 'EU_DISTANCE_SALE', 'EU_REVERSE_CHARGE', 'EXPORT');

ALTER TABLE "User"
  ADD COLUMN "vatValidatedAt" TIMESTAMP(3),
  ADD COLUMN "vatValidationName" TEXT,
  ADD COLUMN "vatValidationAddress" TEXT;

ALTER TABLE "Order"
  ADD COLUMN "taxCountryCode" TEXT NOT NULL DEFAULT 'BE',
  ADD COLUMN "vatTreatment" "VatTreatment" NOT NULL DEFAULT 'DOMESTIC',
  ADD COLUMN "vatRate" DECIMAL(4,2) NOT NULL DEFAULT 21,
  ADD COLUMN "totalExclVat" DECIMAL(10,2),
  ADD COLUMN "totalVat" DECIMAL(10,2),
  ADD COLUMN "customerVatNumber" TEXT,
  ADD COLUMN "taxNote" TEXT;

UPDATE "Order"
SET "totalExclVat" = ROUND("totalAmount" / 1.21, 2),
    "totalVat" = "totalAmount" - ROUND("totalAmount" / 1.21, 2)
WHERE "totalExclVat" IS NULL;

ALTER TABLE "Invoice"
  ADD COLUMN "taxCountryCode" TEXT NOT NULL DEFAULT 'BE',
  ADD COLUMN "vatTreatment" "VatTreatment" NOT NULL DEFAULT 'DOMESTIC',
  ADD COLUMN "taxNote" TEXT;
