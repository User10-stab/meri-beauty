-- Cash-drawer audit trail for CASH POS sales: what the cashier actually
-- received and the change handed back, so a till shortfall can be traced to
-- a specific sale.
ALTER TABLE "Transaction" ADD COLUMN "cashReceived" DECIMAL(65,30);
ALTER TABLE "Transaction" ADD COLUMN "changeGiven" DECIMAL(65,30);
