-- Ajoute le nom complet (canonique) + la région aux prospects.
-- firstName / lastName sont CONSERVÉS : aucune donnée existante n'est
-- écrasée. Le backfill ne remplit fullName que lorsqu'il est NULL, à
-- partir de la concaténation "firstName lastName" (trimée).
-- AlterTable
ALTER TABLE "Prospect" ADD COLUMN "fullName" TEXT,
ADD COLUMN "region" TEXT;

-- Backfill sans perte : ne touche que les lignes où fullName est NULL
-- (donc toutes les lignes existantes) et où au moins un des deux champs
-- est renseigné. Les chaînes vides / espaces seules donnent NULL.
UPDATE "Prospect"
SET "fullName" = NULLIF(TRIM(CONCAT_WS(' ', NULLIF(TRIM("firstName"), ''), NULLIF(TRIM("lastName"), ''))), '')
WHERE "fullName" IS NULL
  AND ("firstName" IS NOT NULL OR "lastName" IS NOT NULL);
