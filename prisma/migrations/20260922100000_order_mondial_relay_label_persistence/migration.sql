-- Mondial Relay label safety: labelRequestedAt is the atomic claim marker
-- written before calling the carrier (closes the double-purchase race);
-- labelUrl is kept only as a fallback reference to the carrier's own PDF
-- link; labelRawResponse is the full last-attempt response/error body for
-- diagnosis, since the regex-based parse has never been checked against a
-- real Mondial Relay response.
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "labelRequestedAt" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "labelUrl" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "labelRawResponse" TEXT;
