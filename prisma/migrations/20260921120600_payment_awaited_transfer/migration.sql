-- An announced-but-not-received bank transfer belongs to the Payment, not to
-- the Order: every counter flow can now be paid that way (manual sale,
-- booking balance, pickup order, counter reservation), and each of them owns
-- a Payment. Nothing is recorded as received until an admin accepts it.
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "awaitedTransferAmount" DECIMAL(10,2);

UPDATE "Payment" p
SET "awaitedTransferAmount" = o."awaitedTransferAmount"
FROM "Order" o
WHERE p."orderId" = o."id" AND o."awaitedTransferAmount" IS NOT NULL;

ALTER TABLE "Order" DROP COLUMN IF EXISTS "awaitedTransferAmount";
