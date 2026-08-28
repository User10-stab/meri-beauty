-- Additive only: two nullable columns, one FK. No data mutation, safe to
-- replay on any environment (including OVH production) without the hazard
-- documented for the earlier HT-storage migration.

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN "pendingRefundCreditNoteId" TEXT;

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN "creditNoteId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_creditNoteId_key" ON "Transaction"("creditNoteId");

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_creditNoteId_fkey" FOREIGN KEY ("creditNoteId") REFERENCES "CreditNote"("id") ON DELETE SET NULL ON UPDATE CASCADE;
