-- AddColumn: Add nextInvoiceDate to Staff for anniversary-based billing tracking
ALTER TABLE "Staff" ADD COLUMN "nextInvoiceDate" TIMESTAMP(3);

-- AddColumn: Add nextInvoiceDate to Contract for anniversary-based billing tracking
ALTER TABLE "Contract" ADD COLUMN "nextInvoiceDate" TIMESTAMP(3);

-- CreateIndex: Index on Staff.nextInvoiceDate for daily billing queries
CREATE INDEX "Staff_nextInvoiceDate_idx" ON "Staff"("nextInvoiceDate");

-- CreateIndex: Index on Contract.nextInvoiceDate for daily billing queries
CREATE INDEX "Contract_nextInvoiceDate_idx" ON "Contract"("nextInvoiceDate");

-- Initialize nextInvoiceDate for existing FIXED_RENT contracts:
-- For each active staff with a FIXED_RENT contract, calculate the next invoice date
-- based on the contract's startDate anniversary.
-- This uses a SQL function to handle month-end logic (e.g., 31st becomes 28/29/30 in other months).

-- Helper function to calculate the next anniversary date (month-end aware)
CREATE OR REPLACE FUNCTION calculate_next_anniversary(
  billing_day_of_month INT,
  from_date TIMESTAMP(3),
  contract_end_date TIMESTAMP(3)
) RETURNS TIMESTAMP(3) AS $$
DECLARE
  next_date TIMESTAMP(3);
  year INT;
  month INT;
  day INT;
  max_day INT;
BEGIN
  -- Extract year, month, and the desired day from input
  year := EXTRACT(YEAR FROM from_date)::INT;
  month := EXTRACT(MONTH FROM from_date)::INT;
  
  -- Start with the first day of next month
  next_date := DATE_TRUNC('month', from_date + INTERVAL '1 month')::TIMESTAMP(3);
  
  -- Determine max day in that month
  max_day := EXTRACT(DAY FROM DATE_TRUNC('month', next_date + INTERVAL '1 month') - INTERVAL '1 day')::INT;
  
  -- Use the minimum of billing_day and max_day to handle month-end
  day := LEAST(billing_day_of_month, max_day);
  
  -- Calculate the actual next date
  next_date := (DATE_TRUNC('month', next_date)::DATE + (day - 1))::TIMESTAMP(3);
  
  -- If contract has endDate and next_date would be after it, return NULL
  IF contract_end_date IS NOT NULL AND next_date > contract_end_date THEN
    RETURN NULL;
  END IF;
  
  RETURN next_date;
END;
$$ LANGUAGE plpgsql;

-- Update nextInvoiceDate for existing FIXED_RENT contracts
UPDATE "Contract" c
SET "nextInvoiceDate" = calculate_next_anniversary(
  EXTRACT(DAY FROM c."startDate")::INT,
  c."startDate",
  c."endDate"
)
WHERE c."type" = 'FIXED_RENT'
  AND c."status" != 'TERMINATED'
  AND c."fixedRent" > 0
  AND EXISTS (
    SELECT 1 FROM "Staff" s
    WHERE s."id" = c."staffId"
      AND s."isActive" = true
      AND s."isDeleted" = false
  );

-- Update Staff.nextInvoiceDate from the earliest active FIXED_RENT contract
UPDATE "Staff" s
SET "nextInvoiceDate" = (
  SELECT MIN(c."nextInvoiceDate")
  FROM "Contract" c
  WHERE c."staffId" = s."id"
    AND c."type" = 'FIXED_RENT'
    AND c."nextInvoiceDate" IS NOT NULL
)
WHERE s."isActive" = true
  AND s."isDeleted" = false
  AND EXISTS (
    SELECT 1 FROM "Contract" c
    WHERE c."staffId" = s."id"
      AND c."type" = 'FIXED_RENT'
      AND c."status" != 'TERMINATED'
      AND c."fixedRent" > 0
  );

-- Clean up the helper function
DROP FUNCTION IF EXISTS calculate_next_anniversary(INT, TIMESTAMP(3), TIMESTAMP(3));
