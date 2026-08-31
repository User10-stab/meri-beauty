-- 2026-08-31 incident: three real customer bookings were destroyed with no
-- error and no audit trace when an ordinary edit was saved on the event they
-- belonged to. updateActivity diffs submitted sessions against existing ones
-- and hard-deletes any session the payload does not list; the single-session
-- form branch omitted the session id, so a plain "Save" deleted the live
-- session, and ON DELETE CASCADE took every reservation on it along.
--
-- A reservation is financial history: it carries a Payment, and through it an
-- Invoice. It must never disappear as a side effect of editing its parent.
-- RESTRICT makes the database itself refuse, so the guarantee no longer
-- depends on every present and future code path remembering to check first.
--
-- The application guards (updateActivity / deleteActivity, updateFormation /
-- deleteFormation) still run ahead of this and return a readable message —
-- this constraint is the backstop for the paths nobody thought of.

ALTER TABLE "workshop_reservations"
  DROP CONSTRAINT "workshop_reservations_sessionId_fkey";

ALTER TABLE "workshop_reservations"
  ADD CONSTRAINT "workshop_reservations_sessionId_fkey"
  FOREIGN KEY ("sessionId") REFERENCES "workshop_sessions"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "formation_reservations"
  DROP CONSTRAINT "formation_reservations_sessionId_fkey";

ALTER TABLE "formation_reservations"
  ADD CONSTRAINT "formation_reservations_sessionId_fkey"
  FOREIGN KEY ("sessionId") REFERENCES "formation_sessions"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
