-- Transaction.creditNoteId was introduced after some refunds and their
-- credit notes already existed. Backfill only unambiguous one-to-one matches:
-- same invoice, same TTC amount, and neither side linked yet.

WITH candidates AS (
  SELECT
    refund.id AS "transactionId",
    note.id AS "creditNoteId",
    COUNT(*) OVER (PARTITION BY refund.id) AS "transactionMatches",
    COUNT(*) OVER (PARTITION BY note.id) AS "creditNoteMatches"
  FROM "Transaction" refund
  JOIN "Payment" payment ON payment.id = refund."paymentId"
  JOIN "Invoice" invoice ON invoice."paymentId" = payment.id
  JOIN "CreditNote" note
    ON note."invoiceId" = invoice.id
   AND note."totalInclVat" = ROUND(refund.amount, 2)
  LEFT JOIN "Transaction" linked ON linked."creditNoteId" = note.id
  WHERE refund."transactionType" = 'REFUND'
    AND NOT refund."isDeleted"
    AND refund."creditNoteId" IS NULL
    AND linked.id IS NULL
)
UPDATE "Transaction" refund
SET "creditNoteId" = candidates."creditNoteId"
FROM candidates
WHERE refund.id = candidates."transactionId"
  AND candidates."transactionMatches" = 1
  AND candidates."creditNoteMatches" = 1;
