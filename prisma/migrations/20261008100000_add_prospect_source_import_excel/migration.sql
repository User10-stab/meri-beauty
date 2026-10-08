-- Nouvelle source "Import Excel" : signe distinctif des prospects venus
-- d'un fichier (par opposition à la création manuelle). Même pattern que
-- 20260924153335_add_prospect_lecteur_status.
-- AlterEnum
ALTER TYPE "ProspectSource" ADD VALUE 'import_excel';
