-- DropForeignKey
ALTER TABLE "Product" DROP CONSTRAINT "Product_brandId_fkey";

-- DropIndex
DROP INDEX "Product_brandId_idx";

-- AlterTable
ALTER TABLE "Product" DROP COLUMN "brandId";

-- AlterTable
ALTER TABLE "ProductCategory" ALTER COLUMN "brandId" SET NOT NULL;
