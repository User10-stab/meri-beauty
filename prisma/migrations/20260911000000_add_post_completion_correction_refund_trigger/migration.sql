-- A COMPLETED/shipped transaction can be corrected after the fact (wrong
-- price charged, wrong data on the invoice/ticket) without reviving the
-- retired FINANCIAL_CORRECTION trigger. Unlike every other trigger, this one
-- is explicitly allowed through the COMPLETED/shipped guards in
-- lib/refunds/authorize.js, but only via the dedicated orchestrator in
-- lib/refunds/correct-completed-transaction.js.
ALTER TYPE "RefundTrigger" ADD VALUE IF NOT EXISTS 'POST_COMPLETION_CORRECTION';
