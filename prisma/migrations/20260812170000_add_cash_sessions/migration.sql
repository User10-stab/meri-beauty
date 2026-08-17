-- CreateTable
CREATE TABLE "CashSession" (
    "id" TEXT NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "openedById" TEXT NOT NULL,
    "openingFloat" DECIMAL(10,2) NOT NULL,
    "closedAt" TIMESTAMP(3),
    "closedById" TEXT,
    "expectedCash" DECIMAL(10,2),
    "countedCash" DECIMAL(10,2),
    "variance" DECIMAL(10,2),
    "note" TEXT,

    CONSTRAINT "CashSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CashSession_closedAt_idx" ON "CashSession"("closedAt");

-- AddForeignKey
ALTER TABLE "CashSession" ADD CONSTRAINT "CashSession_openedById_fkey" FOREIGN KEY ("openedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CashSession" ADD CONSTRAINT "CashSession_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable: link CASH transactions to the till session open at sale time
ALTER TABLE "Transaction" ADD COLUMN "cashSessionId" TEXT;
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_cashSessionId_fkey" FOREIGN KEY ("cashSessionId") REFERENCES "CashSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;
