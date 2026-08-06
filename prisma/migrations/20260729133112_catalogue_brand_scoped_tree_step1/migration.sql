-- DropIndex
DROP INDEX "ProductCategory_slug_idx";

-- DropIndex
DROP INDEX "ProductCategory_slug_key";

-- AlterTable
ALTER TABLE "ProductCategory" ADD COLUMN     "brandId" TEXT;

-- CreateIndex
CREATE INDEX "ProductCategory_brandId_idx" ON "ProductCategory"("brandId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductCategory_brandId_slug_key" ON "ProductCategory"("brandId", "slug");

-- AddForeignKey
ALTER TABLE "ProductCategory" ADD CONSTRAINT "ProductCategory_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

