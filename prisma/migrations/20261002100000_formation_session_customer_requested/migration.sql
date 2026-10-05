-- A private formation's client may now pick her own date (« date libre »).
-- The session that date creates is flagged so it stays out of the public
-- listing, the till and the dashboard's session editor.
ALTER TABLE "formation_sessions" ADD COLUMN "customerRequested" BOOLEAN NOT NULL DEFAULT false;
