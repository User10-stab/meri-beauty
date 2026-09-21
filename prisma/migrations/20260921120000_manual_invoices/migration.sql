-- Manual invoices ("Générer une facture" on /dashboard/factures).
-- New enum values are only ADDED here, never used in this migration, so
-- Postgres accepts them even inside a transaction block.
ALTER TYPE "InvoiceSource" ADD VALUE IF NOT EXISTS 'MANUAL';
ALTER TYPE "OrderSource" ADD VALUE IF NOT EXISTS 'MANUAL';
ALTER TYPE "TransactionMethod" ADD VALUE IF NOT EXISTS 'TRANSFER';

-- Free-text comment printed on the invoice PDF and sent as UBL cbc:Note.
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "notes" TEXT;
