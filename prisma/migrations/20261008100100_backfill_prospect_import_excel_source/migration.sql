-- Backfill sans perte : les prospects créés par un import Excel AVANT
-- l'existence de la source `import_excel` (source `autre` + activité
-- `prospect_created` issue d'un import) sont re-taggués `import_excel`.
-- Les prospects manuels (source autre sans activité d'import) sont
-- intacts, et `firstName` / `lastName` / `fullName` ne sont pas touchés.
-- (Migration séparée de l'ALTER TYPE : Postgres refuse d'utiliser une
-- valeur d'enum ajoutée dans la même transaction.)
UPDATE "Prospect" p
SET "source" = 'import_excel'
WHERE p."source" = 'autre'
  AND EXISTS (
    SELECT 1
    FROM "ProspectActivity" a
    WHERE a."prospectId" = p."id"
      AND a."type" = 'prospect_created'
      AND a."refModel" = 'import_excel'
  );
