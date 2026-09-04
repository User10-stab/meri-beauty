-- AlterEnum
ALTER TYPE "InvoiceSource" ADD VALUE IF NOT EXISTS 'STAFF_CONTRACT';

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN "contractId" TEXT,
ADD COLUMN "dueDate" TIMESTAMP(3),
ALTER COLUMN "paymentId" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_contractId_key" ON "Invoice"("contractId");

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE SET NULL ON UPDATE CASCADE;
