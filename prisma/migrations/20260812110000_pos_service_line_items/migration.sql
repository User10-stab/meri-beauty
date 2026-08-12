-- POS ad-hoc service lines have no ProductVariant behind them, so the
-- OrderItem columns that only make sense for a catalog product become
-- nullable. No backfill needed: every existing row already has them set.

ALTER TABLE "OrderItem" ALTER COLUMN "variantId" DROP NOT NULL;
ALTER TABLE "OrderItem" ALTER COLUMN "variantName" DROP NOT NULL;
ALTER TABLE "OrderItem" ALTER COLUMN "sku" DROP NOT NULL;
