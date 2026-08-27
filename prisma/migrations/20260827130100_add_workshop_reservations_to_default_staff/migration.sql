-- A standard staff member holding only the default permission set could not
-- open the atelier/événement door: scanning a ticket needs
-- WORKSHOP_RESERVATIONS, which was missing from both the column default and
-- every existing Staff row. FORMATION_RESERVATIONS already got this same
-- treatment in 20260824154500_expand_default_staff_permissions — this
-- migration is that one's missing sibling.

ALTER TABLE "Staff"
ALTER COLUMN "dashboardPermissions"
SET DEFAULT ARRAY[
  'APPOINTMENTS',
  'SERVICES',
  'CUSTOMERS',
  'FORMATIONS',
  'FORMATION_RESERVATIONS',
  'WORKSHOP_RESERVATIONS',
  'NEWSLETTER'
]::TEXT[];

UPDATE "Staff"
SET "dashboardPermissions" = ARRAY(
  SELECT DISTINCT permission
  FROM unnest(
    "dashboardPermissions" || ARRAY['WORKSHOP_RESERVATIONS']::TEXT[]
  ) AS permission
);
