-- A point-of-sale customer is identified by their receipt email. Do not force
-- staff to invent a phone number just to complete a counter sale.
ALTER TABLE "User" ALTER COLUMN "phone" DROP NOT NULL;
