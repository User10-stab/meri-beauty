-- Orders already taken over by the till before SETTLED_AT_COUNTER existed.
-- The sale they were replaced by is read from the audit row the till wrote in
-- the same transaction (order.settled_at_point_of_sale, after.replacedByOrderId);
-- the old "Encaissée en caisse — vente n°X" reason and cancellation date are
-- cleared because the order was never cancelled. Only rows matching all three
-- (CANCELLED, that reason, an audit row pointing at a sale that exists) move.
UPDATE "Order" AS o
SET "status" = 'SETTLED_AT_COUNTER',
    "settledBySaleId" = al."saleId",
    "cancelReason" = NULL,
    "cancelledAt" = NULL
FROM (
  SELECT DISTINCT ON ("entityId") "entityId", "after"->>'replacedByOrderId' AS "saleId"
  FROM "AuditLog"
  WHERE "action" = 'order.settled_at_point_of_sale' AND "entityType" = 'Order'
  ORDER BY "entityId", "createdAt" DESC
) AS al
WHERE o."id" = al."entityId"
  AND o."status" = 'CANCELLED'
  AND o."cancelReason" LIKE 'Encaissée en caisse%'
  AND EXISTS (SELECT 1 FROM "Order" AS s WHERE s."id" = al."saleId");
