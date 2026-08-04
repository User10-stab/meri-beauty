-- Revocable token gating each staff member's personal iCal subscription
-- feed. Nullable — generated lazily the first time a staff member requests
-- their feed URL from account settings.
ALTER TABLE "Staff" ADD COLUMN "calendarToken" TEXT;
CREATE UNIQUE INDEX "Staff_calendarToken_key" ON "Staff"("calendarToken");
