-- Staff rent is paid by bank transfer: every rent invoice now gets a PENDING
-- Payment, accepted by an admin from the Factures page once the transfer
-- arrived. That Payment's source is the rent contract (lib/staff-rent-payment.js).
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "staffContractId" TEXT;

CREATE INDEX IF NOT EXISTS "Payment_staffContractId_idx" ON "Payment"("staffContractId");

ALTER TABLE "Payment" DROP CONSTRAINT IF EXISTS "Payment_staffContractId_fkey";
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_staffContractId_fkey" FOREIGN KEY ("staffContractId") REFERENCES "Contract"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Extend the polymorphic Payment source check from 4-way to 5-way.
ALTER TABLE "Payment" DROP CONSTRAINT IF EXISTS "Payment_exactly_one_source";
ALTER TABLE "Payment"
  ADD CONSTRAINT "Payment_exactly_one_source"
  CHECK (
    (CASE WHEN "appointmentId" IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN "orderId" IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN "workshopReservationId" IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN "formationReservationId" IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN "staffContractId" IS NOT NULL THEN 1 ELSE 0 END) = 1
  );
