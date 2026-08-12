-- A rental request is approved if and only if it has been converted into a
-- contract. This protects the invariant from scripts and direct SQL writes,
-- not only from the dashboard action.
-- NOT VALID: 4 pre-existing rows (Jul 2026, before the contract feature
-- existed) are APPROVED with no contractId. Whether to backfill a contract
-- for them or revert their status is a real business decision, not
-- something to guess at in a migration — NOT VALID enforces the invariant
-- for every new/updated row from here on without retroactively rejecting
-- that historical data.
ALTER TABLE "RentalRequest"
  ADD CONSTRAINT "RentalRequest_approved_requires_contract_check"
  CHECK (("status" = 'APPROVED') = ("contractId" IS NOT NULL)) NOT VALID;
