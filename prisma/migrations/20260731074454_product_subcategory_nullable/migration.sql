-- DropForeignKey
ALTER TABLE "Product" DROP CONSTRAINT "Product_subcategoryId_fkey";

-- AlterTable
ALTER TABLE "Product" ALTER COLUMN "subcategoryId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_subcategoryId_fkey" FOREIGN KEY ("subcategoryId") REFERENCES "ProductSubcategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
