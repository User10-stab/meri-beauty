-- Staff may register a formation student who does not have a website account
-- or an e-mail address. Public signup still validates that both are present.
ALTER TABLE "User"
  ALTER COLUMN "email" DROP NOT NULL,
  ALTER COLUMN "password" DROP NOT NULL;

ALTER TABLE "formation_reservations"
  ADD COLUMN "offlineEnrollment" BOOLEAN NOT NULL DEFAULT false;

-- Non-customer identities still need credentials to protect staff access.
ALTER TABLE "User"
  ADD CONSTRAINT "User_non_customer_credentials_required"
  CHECK ("role" = 'CUSTOMER' OR ("email" IS NOT NULL AND "password" IS NOT NULL));
