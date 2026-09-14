-- Per-staff data isolation ("Mes opérations"): who personally recorded each
-- Transaction, plus the deferred-invoice queue for non-privileged staff who
-- can never issue an Invoice directly. See lib/authorization.js
-- (isTillCashOperator, getActingUserId) and actions/dashboard/admin-operations.js.
--
-- Nullable from day one, same pattern as ticketNumber's own migration:
-- historical Transaction rows predate this field and are not backfilled —
-- they simply won't appear in anyone's scoped view. No bulk backfill is
-- attempted, same reasoning as pieceNumber/checkInCode's own migrations.

ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "recordedById" TEXT;
CREATE INDEX IF NOT EXISTS "Transaction_recordedById_idx" ON "Transaction"("recordedById");

DO $$ BEGIN
  ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_recordedById_fkey"
    FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- One row per Payment (mirrors Invoice.paymentId exactly) recording that a
-- non-privileged staff member's sale/settlement would normally have issued
-- an Invoice but didn't — resolved later when an admin/owner issues the
-- real Invoice from the "Factures en attente" queue.
CREATE TABLE IF NOT EXISTS "PendingInvoiceRequest" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "requestedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolvedInvoiceId" TEXT,

    CONSTRAINT "PendingInvoiceRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PendingInvoiceRequest_paymentId_key" ON "PendingInvoiceRequest"("paymentId");
CREATE UNIQUE INDEX IF NOT EXISTS "PendingInvoiceRequest_resolvedInvoiceId_key" ON "PendingInvoiceRequest"("resolvedInvoiceId");
CREATE INDEX IF NOT EXISTS "PendingInvoiceRequest_requestedByUserId_idx" ON "PendingInvoiceRequest"("requestedByUserId");

DO $$ BEGIN
  ALTER TABLE "PendingInvoiceRequest" ADD CONSTRAINT "PendingInvoiceRequest_paymentId_fkey"
    FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "PendingInvoiceRequest" ADD CONSTRAINT "PendingInvoiceRequest_requestedByUserId_fkey"
    FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "PendingInvoiceRequest" ADD CONSTRAINT "PendingInvoiceRequest_resolvedInvoiceId_fkey"
    FOREIGN KEY ("resolvedInvoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
