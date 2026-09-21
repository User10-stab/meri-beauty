-- A manual sale paid by acompte or later is only invoiced once fully paid
-- (same rule as every booking deposit). Until then, the comment to print on
-- that invoice and the balance's due date live on the Order.
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "invoiceNotes" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "paymentDueDate" TIMESTAMP(3);
