-- A manual sale paid by bank transfer that has not arrived yet is recorded
-- unpaid, with the amount expected. The transfer is only recorded (and the
-- invoice only issued) once staff mark it « Virement reçu » with its reference.
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "awaitedTransferAmount" DECIMAL(10,2);
