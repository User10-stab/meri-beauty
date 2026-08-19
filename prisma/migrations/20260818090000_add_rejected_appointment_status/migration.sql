-- REJECTED is the terminal status of a manually-confirmed request the salon
-- turned down before ever accepting it — distinct from CANCELLED, which is a
-- real booking being withdrawn. Same ADD VALUE IF NOT EXISTS pattern as
-- 20260813081903 (ACCEPTED), so it is safe to deploy on shared databases.
ALTER TYPE "AppointmentStatus" ADD VALUE IF NOT EXISTS 'REJECTED';