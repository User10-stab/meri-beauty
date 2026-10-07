-- Multi-offer promo codes: one code (type MULTI_RULE) bundling several rules,
-- each with its own targets (brand / category / subcategory / product) and
-- mechanic. OrderItem gains its own share of the order discount, since the
-- offers differ per line. Purely additive.

-- CreateEnum
CREATE TYPE "PromoRuleKind" AS ENUM ('PERCENT_OFF', 'NTH_DISCOUNTED', 'BUY_X_GET_Y_FREE');

-- AlterEnum
ALTER TYPE "PromoCodeType" ADD VALUE 'MULTI_RULE';

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "discountAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
ADD COLUMN     "promoLabel" TEXT;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "promoSnapshot" JSONB;

-- CreateTable
CREATE TABLE "PromoCodeRule" (
    "id" TEXT NOT NULL,
    "promoCodeId" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "label" TEXT NOT NULL,
    "kind" "PromoRuleKind" NOT NULL,
    "percent" DECIMAL(5,2),
    "minQuantity" INTEGER NOT NULL DEFAULT 1,
    "buyQuantity" INTEGER,
    "freeQuantity" INTEGER,
    "samePriceOnly" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "PromoCodeRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_PromoRuleBrands" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_PromoRuleBrands_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_PromoRuleCategories" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_PromoRuleCategories_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_PromoRuleSubcategories" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_PromoRuleSubcategories_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_PromoRuleProducts" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_PromoRuleProducts_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "PromoCodeRule_promoCodeId_idx" ON "PromoCodeRule"("promoCodeId");

-- CreateIndex
CREATE INDEX "_PromoRuleBrands_B_index" ON "_PromoRuleBrands"("B");

-- CreateIndex
CREATE INDEX "_PromoRuleCategories_B_index" ON "_PromoRuleCategories"("B");

-- CreateIndex
CREATE INDEX "_PromoRuleSubcategories_B_index" ON "_PromoRuleSubcategories"("B");

-- CreateIndex
CREATE INDEX "_PromoRuleProducts_B_index" ON "_PromoRuleProducts"("B");

-- AddForeignKey
ALTER TABLE "PromoCodeRule" ADD CONSTRAINT "PromoCodeRule_promoCodeId_fkey" FOREIGN KEY ("promoCodeId") REFERENCES "PromoCode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_PromoRuleBrands" ADD CONSTRAINT "_PromoRuleBrands_A_fkey" FOREIGN KEY ("A") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_PromoRuleBrands" ADD CONSTRAINT "_PromoRuleBrands_B_fkey" FOREIGN KEY ("B") REFERENCES "PromoCodeRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_PromoRuleCategories" ADD CONSTRAINT "_PromoRuleCategories_A_fkey" FOREIGN KEY ("A") REFERENCES "ProductCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_PromoRuleCategories" ADD CONSTRAINT "_PromoRuleCategories_B_fkey" FOREIGN KEY ("B") REFERENCES "PromoCodeRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_PromoRuleSubcategories" ADD CONSTRAINT "_PromoRuleSubcategories_A_fkey" FOREIGN KEY ("A") REFERENCES "ProductSubcategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_PromoRuleSubcategories" ADD CONSTRAINT "_PromoRuleSubcategories_B_fkey" FOREIGN KEY ("B") REFERENCES "PromoCodeRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_PromoRuleProducts" ADD CONSTRAINT "_PromoRuleProducts_A_fkey" FOREIGN KEY ("A") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_PromoRuleProducts" ADD CONSTRAINT "_PromoRuleProducts_B_fkey" FOREIGN KEY ("B") REFERENCES "PromoCodeRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;
