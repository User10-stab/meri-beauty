-- AlterTable
ALTER TABLE "CashSession" ADD COLUMN     "isAutoClosed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isAutoOpened" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "verificationNote" TEXT,
ADD COLUMN     "verifiedAt" TIMESTAMP(3),
ADD COLUMN     "verifiedById" TEXT,
ADD COLUMN     "verifiedVariance" DECIMAL(10,2);

-- AddForeignKey
ALTER TABLE "CashSession" ADD CONSTRAINT "CashSession_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
