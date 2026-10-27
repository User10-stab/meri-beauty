-- Coordonnées de la candidate dans le formulaire de location de cabine
-- (« Vous souhaitez nous rejoindre ? », audit MB-004) : nom, prénom, e-mail,
-- téléphone. Colonnes additives et nullables — les demandes déjà reçues n'en
-- ont pas, leurs coordonnées restent celles du compte User lié.
-- IF NOT EXISTS : la migration peut être appliquée à la main (db execute +
-- migrate resolve) puis rejouée par `migrate deploy` sans erreur.
ALTER TABLE "RentalRequest" ADD COLUMN IF NOT EXISTS "firstName" TEXT;
ALTER TABLE "RentalRequest" ADD COLUMN IF NOT EXISTS "lastName" TEXT;
ALTER TABLE "RentalRequest" ADD COLUMN IF NOT EXISTS "email" TEXT;
ALTER TABLE "RentalRequest" ADD COLUMN IF NOT EXISTS "phone" TEXT;
