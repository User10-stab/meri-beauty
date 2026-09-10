-- CreateEnum
CREATE TYPE "StaffMonthlyInvoiceStatus" AS ENUM ('PENDING', 'GENERATED', 'SENT', 'EMAIL_FAILED', 'SKIPPED', 'ERROR');

-- CreateTable
CREATE TABLE "StaffMonthlyInvoice" (
    "id" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "billingYear" INTEGER NOT NULL,
    "billingMonth" INTEGER NOT NULL,
    "invoiceId" TEXT,
    "contractId" TEXT,
    "status" "StaffMonthlyInvoiceStatus" NOT NULL DEFAULT 'PENDING',
    "emailSentAt" TIMESTAMP(3),
    "emailError" TEXT,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaffMonthlyInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StaffMonthlyInvoice_invoiceId_key" ON "StaffMonthlyInvoice"("invoiceId");

-- CreateIndex
CREATE INDEX "StaffMonthlyInvoice_billingYear_billingMonth_idx" ON "StaffMonthlyInvoice"("billingYear", "billingMonth");

-- CreateIndex
CREATE INDEX "StaffMonthlyInvoice_status_idx" ON "StaffMonthlyInvoice"("status");

-- CreateIndex
CREATE UNIQUE INDEX "StaffMonthlyInvoice_staffId_billingYear_billingMonth_key" ON "StaffMonthlyInvoice"("staffId", "billingYear", "billingMonth");

-- AddForeignKey
ALTER TABLE "StaffMonthlyInvoice" ADD CONSTRAINT "StaffMonthlyInvoice_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffMonthlyInvoice" ADD CONSTRAINT "StaffMonthlyInvoice_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
