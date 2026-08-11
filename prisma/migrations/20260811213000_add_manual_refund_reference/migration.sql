-- A physical card-terminal refund cannot be initiated by the application.
-- Preserve the terminal's receipt/reference on the resulting refund ledger
-- row so the accounting trail is independently verifiable.
ALTER TABLE "Transaction" ADD COLUMN "manualReference" TEXT;
