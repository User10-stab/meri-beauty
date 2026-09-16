-- POINT_OF_SALE, CASH_REGISTER, ORDERS and SEND_TICKET_EMAIL are no longer
-- staff permissions (16/09/2026). The till, the Livre de caisse, boutique
-- orders and the ticket e-mail belong to the salon's own accounts only
-- (isTillCashOperator in lib/authorization.js: admin + Marie Mercier), since
-- every other practitioner is legally independent. The application already
-- ignores these values; this removes them from the stored lists so nothing
-- stale is left behind. Idempotent: only rows still holding one are touched.

UPDATE "Staff"
SET "dashboardPermissions" = ARRAY(
  SELECT permission
  FROM unnest("dashboardPermissions") AS permission
  WHERE permission NOT IN ('POINT_OF_SALE', 'CASH_REGISTER', 'ORDERS', 'SEND_TICKET_EMAIL')
)
WHERE "dashboardPermissions" && ARRAY['POINT_OF_SALE', 'CASH_REGISTER', 'ORDERS', 'SEND_TICKET_EMAIL']::TEXT[];
