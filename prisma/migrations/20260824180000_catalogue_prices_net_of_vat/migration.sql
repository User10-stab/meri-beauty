-- Catalogue prices move from VAT-inclusive to NET (hors TVA).
--
-- Until now ProductVariant.price, Activity.price and Formation.price held a
-- Belgian VAT-inclusive amount, and applyVatRate() (then repriceBelgianGross)
-- divided by 1.21 before applying whatever rate actually applied. That storage
-- was ambiguous -- the admin form said only "Prix de vente (\u20ac)", so a net price
-- typed there was silently sold 21 % too cheap -- and it made the unit price
-- excluding VAT, a mandatory invoice mention under art. 226(8) of directive
-- 2006/112/CE, a derived and rounded figure rather than the stored one.
--
-- Widened to 4 decimals FIRST, and deliberately so: 25.95 / 1.21 is
-- 21.446280..., and rounding that to 2 decimals then re-applying 21 % gives
-- back a different cent for 17 % of all prices. At 4 decimals every existing
-- price round-trips exactly, so no customer sees a price change.
--
-- ONE-SHOT AND IRREVERSIBLE. Re-running it would divide already-net prices a
-- second time. To undo: multiply the same columns by 1.21 and narrow back to
-- Decimal(10,2).

ALTER TABLE "ProductVariant"
  ALTER COLUMN "price" TYPE DECIMAL(10,4),
  ALTER COLUMN "comparePrice" TYPE DECIMAL(10,4);

ALTER TABLE "workshops"   ALTER COLUMN "price" TYPE DECIMAL(10,4);
ALTER TABLE "formations"  ALTER COLUMN "price" TYPE DECIMAL(10,4);

-- 1.21 is hardcoded rather than read from a setting: these rows ARE Belgian
-- 21 % gross amounts, whatever the rate becomes later.
UPDATE "ProductVariant"
   SET "price"        = ROUND("price" / 1.21, 4),
       "comparePrice" = ROUND("comparePrice" / 1.21, 4)
 WHERE "price" IS NOT NULL;

UPDATE "workshops"  SET "price" = ROUND("price" / 1.21, 4);
UPDATE "formations" SET "price" = ROUND("price" / 1.21, 4);

-- costPrice is untouched: a supplier cost was never a VAT-inclusive shelf
-- price, and the margin shown in the dashboard (price - costPrice) is only
-- meaningful now that both sides are net.
