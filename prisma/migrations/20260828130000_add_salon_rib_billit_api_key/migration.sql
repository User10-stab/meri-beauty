-- Add RIB (bank account) and Billit API key to the Salon table
ALTER TABLE "Salon" ADD COLUMN IF NOT EXISTS "rib" TEXT;
ALTER TABLE "Salon" ADD COLUMN IF NOT EXISTS "billitApiKey" TEXT;
