-- « Nom professionnel » of an independent staff member. When set it is the
-- « Entreprise » line of her future rent invoices, ahead of companyName.
-- Nullable, no backfill: invoices already issued keep their own copy of the buyer.
ALTER TABLE "Staff" ADD COLUMN "professionalName" TEXT;
