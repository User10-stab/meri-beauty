-- « Nom d'entreprise » of an independent staff member, printed as
-- « Entreprise » on her future rent invoices. Nullable, no backfill:
-- invoices already issued keep their own copy of the buyer.
ALTER TABLE "Staff" ADD COLUMN "companyName" TEXT;
