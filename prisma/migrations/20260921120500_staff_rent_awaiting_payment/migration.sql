-- Staff rent is only invoiced once its transfer is accepted. Until then the
-- StaffMonthlyInvoice row holds the rent due (AWAITING_PAYMENT) and its
-- pending Payment; no invoice, no number consumed.
ALTER TYPE "StaffMonthlyInvoiceStatus" ADD VALUE IF NOT EXISTS 'AWAITING_PAYMENT';

ALTER TABLE "StaffMonthlyInvoice" ADD COLUMN IF NOT EXISTS "paymentId" TEXT;
ALTER TABLE "StaffMonthlyInvoice" ADD COLUMN IF NOT EXISTS "amount" DECIMAL(10,2);
ALTER TABLE "StaffMonthlyInvoice" ADD COLUMN IF NOT EXISTS "lineDescription" TEXT;
ALTER TABLE "StaffMonthlyInvoice" ADD COLUMN IF NOT EXISTS "dueDate" TIMESTAMP(3);

CREATE UNIQUE INDEX IF NOT EXISTS "StaffMonthlyInvoice_paymentId_key" ON "StaffMonthlyInvoice"("paymentId");

ALTER TABLE "StaffMonthlyInvoice" DROP CONSTRAINT IF EXISTS "StaffMonthlyInvoice_paymentId_fkey";
ALTER TABLE "StaffMonthlyInvoice" ADD CONSTRAINT "StaffMonthlyInvoice_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
