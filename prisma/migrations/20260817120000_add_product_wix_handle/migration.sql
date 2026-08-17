-- Stable per-product Wix "handle", set on Wix import so a later re-import
-- (e.g. after barcodes are filled in on Wix) recognizes the same product
-- and backfills it instead of creating a duplicate.
ALTER TABLE "Product" ADD COLUMN "wixHandle" TEXT;

CREATE UNIQUE INDEX "Product_wixHandle_key" ON "Product"("wixHandle");
