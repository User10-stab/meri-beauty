-- Promo code targeting: scopes (boutique / prestations / ateliers / formations),
-- optional product / service / customer restrictions, per-customer usage cap.

-- CreateEnum
CREATE TYPE "PromoCodeScope" AS ENUM ('BOUTIQUE', 'APPOINTMENT', 'WORKSHOP', 'FORMATION');

-- AlterTable
ALTER TABLE "PromoCode" ADD COLUMN     "description" TEXT,
ADD COLUMN     "maxUsesPerCustomer" INTEGER,
ADD COLUMN     "scopes" "PromoCodeScope"[] DEFAULT ARRAY['BOUTIQUE', 'APPOINTMENT', 'WORKSHOP', 'FORMATION']::"PromoCodeScope"[];

-- CreateTable
CREATE TABLE "_PromoCodeProducts" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_PromoCodeProducts_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_PromoCodeServices" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_PromoCodeServices_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_PromoCodeCustomers" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_PromoCodeCustomers_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "_PromoCodeProducts_B_index" ON "_PromoCodeProducts"("B");

-- CreateIndex
CREATE INDEX "_PromoCodeServices_B_index" ON "_PromoCodeServices"("B");

-- CreateIndex
CREATE INDEX "_PromoCodeCustomers_B_index" ON "_PromoCodeCustomers"("B");

-- AddForeignKey
ALTER TABLE "_PromoCodeProducts" ADD CONSTRAINT "_PromoCodeProducts_A_fkey" FOREIGN KEY ("A") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_PromoCodeProducts" ADD CONSTRAINT "_PromoCodeProducts_B_fkey" FOREIGN KEY ("B") REFERENCES "PromoCode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_PromoCodeServices" ADD CONSTRAINT "_PromoCodeServices_A_fkey" FOREIGN KEY ("A") REFERENCES "PromoCode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_PromoCodeServices" ADD CONSTRAINT "_PromoCodeServices_B_fkey" FOREIGN KEY ("B") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_PromoCodeCustomers" ADD CONSTRAINT "_PromoCodeCustomers_A_fkey" FOREIGN KEY ("A") REFERENCES "PromoCode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_PromoCodeCustomers" ADD CONSTRAINT "_PromoCodeCustomers_B_fkey" FOREIGN KEY ("B") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
