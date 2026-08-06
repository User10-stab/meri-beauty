-- CreateEnum
CREATE TYPE "AllowedPaymentMethods" AS ENUM ('BOTH', 'ONLINE_ONLY', 'CASH_ONLY');

-- AlterTable
ALTER TABLE "Staff" ADD COLUMN     "allowedPaymentMethods" "AllowedPaymentMethods" NOT NULL DEFAULT 'BOTH';
