-- Whose money a payment is (null = the salon), and the Stripe connected
-- account its online charge lives on. See lib/payments/resolve-payee.js.
ALTER TABLE "Payment" ADD COLUMN "payeeStaffId" TEXT;
ALTER TABLE "Payment" ADD COLUMN "stripeAccountId" TEXT;
CREATE INDEX "Payment_payeeStaffId_idx" ON "Payment"("payeeStaffId");
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_payeeStaffId_fkey" FOREIGN KEY ("payeeStaffId") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- The staff profile an animator is, replacing the e-mail match.
ALTER TABLE "animators" ADD COLUMN "staffId" TEXT;
CREATE UNIQUE INDEX "animators_staffId_key" ON "animators"("staffId");
ALTER TABLE "animators" ADD CONSTRAINT "animators_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;
