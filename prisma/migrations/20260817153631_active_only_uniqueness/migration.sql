-- DropForeignKey
ALTER TABLE "Order" DROP CONSTRAINT "Order_userId_fkey";

-- DropForeignKey
ALTER TABLE "OrderItem" DROP CONSTRAINT "OrderItem_variantId_fkey";

-- DropIndex
DROP INDEX "Staff_vatNumber_key";

-- DropIndex
DROP INDEX "User_email_key";

-- DropIndex
DROP INDEX "User_phone_key";

-- AlterTable
ALTER TABLE "RentalRequest" ALTER COLUMN "specialty" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Staff" ALTER COLUMN "vatNumber" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "Order"
ADD CONSTRAINT "Order_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem"
ADD CONSTRAINT "OrderItem_variantId_fkey"
FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

-- Active-only unique indexes
CREATE UNIQUE INDEX "user_active_email_idx"
ON "User" (lower(email))
WHERE "isDeleted" = false;

CREATE UNIQUE INDEX "user_active_phone_idx"
ON "User" (phone)
WHERE "isDeleted" = false AND phone IS NOT NULL;

CREATE UNIQUE INDEX "staff_active_vat_number_idx"
ON "Staff" ("vatNumber")
WHERE "isDeleted" = false AND "vatNumber" IS NOT NULL;