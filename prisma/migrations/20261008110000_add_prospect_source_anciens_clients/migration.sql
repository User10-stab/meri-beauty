-- Nouvelle source "Anciens clients" : prospects réimportés depuis un
-- export existant (ex. Podia), ciblables via le segment d'audience
-- `anciens_clients` des campagnes. Même pattern que
-- 20261008100000_add_prospect_source_import_excel.
-- AlterEnum
ALTER TYPE "ProspectSource" ADD VALUE 'anciens_clients';
