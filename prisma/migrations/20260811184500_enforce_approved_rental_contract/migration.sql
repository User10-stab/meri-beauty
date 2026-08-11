-- A rental request is approved if and only if it has been converted into a
-- contract. This protects the invariant from scripts and direct SQL writes,
-- not only from the dashboard action.
ALTER TABLE "RentalRequest"
  ADD CONSTRAINT "RentalRequest_approved_requires_contract_check"
  CHECK (("status" = 'APPROVED') = ("contractId" IS NOT NULL));
