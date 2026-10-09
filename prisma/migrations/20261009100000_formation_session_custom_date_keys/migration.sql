-- « Date libre »: the journées of a private formation no longer have to be
-- consecutive, so the session stores the exact Brussels days it is held on.
-- Empty for scheduled sessions and for dates picked before this migration
-- (those run on every day from startDate to endDate). Additive only.
ALTER TABLE "formation_sessions" ADD COLUMN "customDateKeys" TEXT[] DEFAULT ARRAY[]::TEXT[];
