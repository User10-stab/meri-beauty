-- The production product catalogue was confirmed by the owner to contain
-- Belgian consumer prices that had been multiplied by 1.21 even though the
-- entered amounts were already TTC. Undo that duplicate VAT application once.
--
-- This intentionally affects only customer-facing product selling prices.
-- ProductVariant.costPrice is a supplier cost HT, while workshop and formation
-- prices are separate catalogues and are outside this production correction.

UPDATE "ProductVariant"
SET "price" = ROUND("price" / 1.21, 2),
    "comparePrice" = CASE
      WHEN "comparePrice" IS NULL THEN NULL
      ELSE ROUND("comparePrice" / 1.21, 2)
    END;
