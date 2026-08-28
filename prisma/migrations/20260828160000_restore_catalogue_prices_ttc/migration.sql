-- Catalogue prices were entered as Belgian consumer prices with 21% VAT
-- already included. Migration 20260824180000_catalogue_prices_net_of_vat
-- divided those amounts by 1.21 under the wrong storage assumption.
--
-- Restore the original TTC amounts with a forward-only migration. Keeping the
-- earlier migration intact is essential for databases where it has already
-- been applied; a fresh database also runs divide then multiply and ends in
-- the same TTC state.

ALTER TABLE "ProductVariant"
  ALTER COLUMN "price" TYPE DECIMAL(10,2) USING ROUND("price" * 1.21, 2),
  ALTER COLUMN "comparePrice" TYPE DECIMAL(10,2) USING ROUND("comparePrice" * 1.21, 2);

ALTER TABLE "workshops"
  ALTER COLUMN "price" TYPE DECIMAL(10,2) USING ROUND("price" * 1.21, 2);

ALTER TABLE "formations"
  ALTER COLUMN "price" TYPE DECIMAL(10,2) USING ROUND("price" * 1.21, 2);

-- costPrice remains untouched: it is the supplier cost HT, not a customer
-- catalogue price.
