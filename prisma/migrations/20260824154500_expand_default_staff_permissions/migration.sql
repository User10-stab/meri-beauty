ALTER TABLE "Staff"
ALTER COLUMN "dashboardPermissions"
SET DEFAULT ARRAY[
  'APPOINTMENTS',
  'SERVICES',
  'CUSTOMERS',
  'FORMATIONS',
  'FORMATION_RESERVATIONS',
  'NEWSLETTER'
]::TEXT[];

UPDATE "Staff"
SET "dashboardPermissions" = ARRAY(
  SELECT DISTINCT permission
  FROM unnest(
    "dashboardPermissions" || ARRAY[
      'APPOINTMENTS',
      'SERVICES',
      'CUSTOMERS',
      'FORMATIONS',
      'FORMATION_RESERVATIONS',
      'NEWSLETTER'
    ]::TEXT[]
  ) AS permission
);
