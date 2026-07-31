-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "customerVatNumber" TEXT;

-- AlterTable
ALTER TABLE "ProductVariant" ADD COLUMN     "weightGrams" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "vatNumber" TEXT;
