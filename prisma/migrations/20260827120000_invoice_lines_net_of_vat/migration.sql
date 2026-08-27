-- Invoice lines gain their VAT-exclusive twin.
--
-- Article 226(8) of directive 2006/112/CE requires the unit price EXCLUDING
-- VAT on every invoice line. Until now InvoiceLine carried only the
-- VAT-inclusive amount charged, and lib/pdf/theme.jsx printed it under a
-- "P.U. TTC" header -- a legally incomplete document.
--
-- The gross columns are KEPT, not converted. An issued invoice is immutable
-- under Belgian law, so the amount actually charged stays exactly as it was
-- printed; the net figures are added alongside it.
--
-- 4 decimals on the unit price for the same reason the catalogue uses them
-- (see 20260824180000_catalogue_prices_net_of_vat): at 2 decimals, 17 % of
-- prices do not survive the divide-then-reapply round trip, and the unit
-- price printed on the invoice would stop matching the catalogue price that
-- was actually set.

ALTER TABLE "InvoiceLine"
  ADD COLUMN "unitPriceExclVat" DECIMAL(10,4) NOT NULL DEFAULT 0,
  ADD COLUMN "lineTotalExclVat" DECIMAL(10,2) NOT NULL DEFAULT 0;

-- Backfill from each line's own invoice rate, never a hardcoded 21 %: an
-- intra-Community B2B invoice was issued at 0 %, and dividing its lines by
-- 1.21 would invent VAT that was never charged.
UPDATE "InvoiceLine" l
   SET "unitPriceExclVat" = ROUND(l."unitPrice" / (1 + i."vatRate" / 100), 4),
       "lineTotalExclVat" = ROUND(l."lineTotal" / (1 + i."vatRate" / 100), 2)
  FROM "Invoice" i
 WHERE i."id" = l."invoiceId";

-- Historical lines are derived, so a rounding residual can leave them summing
-- to a cent either side of the invoice's stored subtotal. Push that residual
-- onto each invoice's largest line -- the same allocation issueInvoice now
-- applies going forward, so old and new documents add up identically.
WITH residuals AS (
  SELECT i."id" AS invoice_id,
         i."subtotalExclVat" - COALESCE(SUM(l."lineTotalExclVat"), 0) AS residual
    FROM "Invoice" i
    JOIN "InvoiceLine" l ON l."invoiceId" = i."id"
   GROUP BY i."id", i."subtotalExclVat"
  HAVING i."subtotalExclVat" - COALESCE(SUM(l."lineTotalExclVat"), 0) <> 0
),
targets AS (
  SELECT DISTINCT ON (l."invoiceId") l."id" AS line_id, r.residual
    FROM "InvoiceLine" l
    JOIN residuals r ON r.invoice_id = l."invoiceId"
   ORDER BY l."invoiceId", ABS(l."lineTotal") DESC, l."id"
)
UPDATE "InvoiceLine" l
   SET "lineTotalExclVat" = l."lineTotalExclVat" + t.residual
  FROM targets t
 WHERE t.line_id = l."id";
