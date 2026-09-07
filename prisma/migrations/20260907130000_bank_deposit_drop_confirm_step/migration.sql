-- Every deposit is recorded by the same admin who made the trip to the
-- bank, so a second "confirm" click by that same person was never a real
-- check on the first one — just an extra step. Collapsing the two-step
-- declared/confirmed lifecycle into one action: declaring a deposit is now
-- the whole record.
ALTER TABLE "BankDeposit" DROP CONSTRAINT IF EXISTS "BankDeposit_confirmedById_fkey";
ALTER TABLE "BankDeposit" DROP COLUMN "status";
ALTER TABLE "BankDeposit" DROP COLUMN "confirmedAt";
ALTER TABLE "BankDeposit" DROP COLUMN "confirmedById";
DROP INDEX IF EXISTS "BankDeposit_status_idx";
DROP TYPE IF EXISTS "BankDepositStatus";
