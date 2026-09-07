-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN "supersedesInvoiceId" TEXT,
ADD COLUMN "supersededAt" TIMESTAMP(3),
ADD COLUMN "supersededReason" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_supersedesInvoiceId_key" ON "Invoice"("supersedesInvoiceId");

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_supersedesInvoiceId_fkey" FOREIGN KEY ("supersedesInvoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
