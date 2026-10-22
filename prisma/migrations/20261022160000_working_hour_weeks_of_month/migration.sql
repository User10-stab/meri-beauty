-- Which occurrences of a weekday in the month a staff member works (1–4);
-- empty = every week. See lib/working-day-overrides.js.
ALTER TABLE "WorkingHour" ADD COLUMN "weeksOfMonth" INTEGER[] DEFAULT ARRAY[]::INTEGER[];
