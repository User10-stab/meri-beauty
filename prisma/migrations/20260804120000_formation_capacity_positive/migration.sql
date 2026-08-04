-- Formations have no admin-facing capacity ceiling (unlike the workshops'
-- CHECK (capacity <= 8)) by design — "no seat cap" for Group formations
-- means no artificial maximum, not literally unbounded. But nothing at the
-- DB level previously stopped capacity from being 0 or negative, which
-- would make `available = capacity - takenSeats` go negative and silently
-- reject every booking. The app's own create/update forms already validate
-- capacity as a positive integer, so this is a backstop, not the primary
-- guard — same role the workshops_capacity_max8 constraint plays there.
ALTER TABLE "formations" ADD CONSTRAINT "formations_capacity_positive" CHECK ("capacity" > 0);
ALTER TABLE "formation_sessions" ADD CONSTRAINT "formation_sessions_capacity_positive" CHECK ("capacity" > 0);
