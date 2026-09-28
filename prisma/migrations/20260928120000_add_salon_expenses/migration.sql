-- Gestion page: the salon's own running costs (électricité, eau, internet,
-- loyer du local…), entered by hand and subtracted from the period margin.
-- Purely additive.

-- CreateEnum
CREATE TYPE "SalonExpenseCategory" AS ENUM ('RENT', 'ELECTRICITY', 'WATER', 'INTERNET', 'OTHER');

-- CreateTable
CREATE TABLE "SalonExpense" (
    "id" TEXT NOT NULL,
    "category" "SalonExpenseCategory" NOT NULL,
    "label" TEXT NOT NULL,
    "amountTtc" DECIMAL(10,2) NOT NULL,
    "vatRate" DECIMAL(4,2) NOT NULL DEFAULT 21,
    "date" TIMESTAMP(3) NOT NULL,
    "isRecurring" BOOLEAN NOT NULL DEFAULT false,
    "endDate" TIMESTAMP(3),
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalonExpense_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SalonExpense_isDeleted_date_idx" ON "SalonExpense"("isDeleted", "date");

-- AddForeignKey
ALTER TABLE "SalonExpense" ADD CONSTRAINT "SalonExpense_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
