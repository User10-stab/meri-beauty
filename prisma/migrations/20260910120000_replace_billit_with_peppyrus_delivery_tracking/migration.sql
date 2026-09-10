-- AlterTable
ALTER TABLE "CreditNote" DROP COLUMN "billitOrderId",
DROP COLUMN "billitSentAt",
ADD COLUMN     "peppyrusMessageId" TEXT,
ADD COLUMN     "peppyrusSentAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Invoice" DROP COLUMN "billitOrderId",
DROP COLUMN "billitSentAt",
ADD COLUMN     "peppyrusMessageId" TEXT,
ADD COLUMN     "peppyrusSentAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Salon" DROP COLUMN "billitApiKey",
ADD COLUMN     "peppyrusApiKey" TEXT;
