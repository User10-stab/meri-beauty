-- CreateEnum
CREATE TYPE "CashMovementType" AS ENUM ('EXPENSE', 'CASH_IN', 'WITHDRAWAL');

-- CreateEnum
CREATE TYPE "BankDepositStatus" AS ENUM ('DECLARED', 'CONFIRMED');

-- AlterTable: the cash book's own line number, allocated only for CASH rows
ALTER TABLE "Transaction" ADD COLUMN "pieceNumber" TEXT;
CREATE UNIQUE INDEX "Transaction_pieceNumber_key" ON "Transaction"("pieceNumber");

-- CreateTable
CREATE TABLE "BankDeposit" (
    "id" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "declaredAmount" DECIMAL(10,2) NOT NULL,
    "variance" DECIMAL(10,2) NOT NULL,
    "reference" TEXT NOT NULL,
    "status" "BankDepositStatus" NOT NULL DEFAULT 'DECLARED',
    "note" TEXT,
    "declaredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "declaredById" TEXT NOT NULL,
    "confirmedAt" TIMESTAMP(3),
    "confirmedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BankDeposit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BankDeposit_reference_key" ON "BankDeposit"("reference");
CREATE INDEX "BankDeposit_status_idx" ON "BankDeposit"("status");

-- AddForeignKey
ALTER TABLE "BankDeposit" ADD CONSTRAINT "BankDeposit_declaredById_fkey" FOREIGN KEY ("declaredById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BankDeposit" ADD CONSTRAINT "BankDeposit_confirmedById_fkey" FOREIGN KEY ("confirmedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "CashMovement" (
    "id" TEXT NOT NULL,
    "cashSessionId" TEXT NOT NULL,
    "type" "CashMovementType" NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "label" TEXT NOT NULL,
    "pieceNumber" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recordedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "bankDepositId" TEXT,

    CONSTRAINT "CashMovement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CashMovement_pieceNumber_key" ON "CashMovement"("pieceNumber");
CREATE INDEX "CashMovement_cashSessionId_occurredAt_idx" ON "CashMovement"("cashSessionId", "occurredAt");
CREATE INDEX "CashMovement_bankDepositId_idx" ON "CashMovement"("bankDepositId");

-- AddForeignKey
ALTER TABLE "CashMovement" ADD CONSTRAINT "CashMovement_cashSessionId_fkey" FOREIGN KEY ("cashSessionId") REFERENCES "CashSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CashMovement" ADD CONSTRAINT "CashMovement_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CashMovement" ADD CONSTRAINT "CashMovement_bankDepositId_fkey" FOREIGN KEY ("bankDepositId") REFERENCES "BankDeposit"("id") ON DELETE SET NULL ON UPDATE CASCADE;
