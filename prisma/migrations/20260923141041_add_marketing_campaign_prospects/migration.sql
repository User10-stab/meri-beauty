-- DropForeignKey
ALTER TABLE "Invoice" DROP CONSTRAINT "Invoice_contractId_fkey";

-- DropIndex
DROP INDEX "Contract_nextInvoiceDate_idx";

-- DropIndex
DROP INDEX "Staff_nextInvoiceDate_idx";
