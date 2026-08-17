-- AlterTable: add nullable first — existing rows are backfilled below,
-- then the columns are locked to NOT NULL.
ALTER TABLE "CreditNote" ADD COLUMN "subtotalExclVat" DECIMAL(10,2);
ALTER TABLE "CreditNote" ADD COLUMN "vatRate" DECIMAL(4,2);
ALTER TABLE "CreditNote" ADD COLUMN "vatAmount" DECIMAL(10,2);

-- Backfill from each credit note's own invoice rate — same formula as
-- lib/tax-policy.js#calculateVatTotals (totalExclVat = totalInclVat / (1 + rate/100)).
UPDATE "CreditNote" cn
SET "vatRate" = inv."vatRate",
    "subtotalExclVat" = ROUND(cn."totalInclVat" / (1 + inv."vatRate" / 100), 2),
    "vatAmount" = cn."totalInclVat" - ROUND(cn."totalInclVat" / (1 + inv."vatRate" / 100), 2)
FROM "Invoice" inv
WHERE inv."id" = cn."invoiceId";

ALTER TABLE "CreditNote" ALTER COLUMN "subtotalExclVat" SET NOT NULL;
ALTER TABLE "CreditNote" ALTER COLUMN "vatRate" SET NOT NULL;
ALTER TABLE "CreditNote" ALTER COLUMN "vatAmount" SET NOT NULL;
