-- Structured return-reason category, distinct from the free-text `reason`
-- detail field — lets withdrawalWindow() apply the 14-day right only to
-- CHANGED_MIND requests, not to defect/error/carrier claims governed by
-- other legal bases. Existing rows default to CHANGED_MIND (the strictest
-- category), since they predate this distinction.
CREATE TYPE "ReturnReasonCategory" AS ENUM ('CHANGED_MIND', 'DEFECTIVE', 'WRONG_ITEM', 'DAMAGED_IN_TRANSIT', 'NOT_RECEIVED', 'GOODWILL');

ALTER TABLE "ReturnRequest" ADD COLUMN "reasonCategory" "ReturnReasonCategory" NOT NULL DEFAULT 'CHANGED_MIND';
