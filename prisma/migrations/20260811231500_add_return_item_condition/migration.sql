-- A returned item pulled aside for inspection/disposal instead of going back
-- into vendable stock (see ReturnItemCondition) — audit trail only, does not
-- change ProductVariant.stockQuantity.
ALTER TYPE "MovementType" ADD VALUE 'RETURN_QUARANTINE';

-- Physical condition staff record for each returned line item before any
-- restock decision — see actions/boutique/returns.js completeReturnRequest.
CREATE TYPE "ReturnItemCondition" AS ENUM ('SEALED_RESELLABLE', 'OPENED_HYGIENE', 'DAMAGED', 'DEFECTIVE', 'WRONG_ITEM');

ALTER TABLE "ReturnRequestItem" ADD COLUMN "condition" "ReturnItemCondition";
