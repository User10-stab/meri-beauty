-- Hands every past payment to its owner, in the same `migrate deploy` that
-- creates the columns — BEFORE the new code starts serving.
--
-- Why this is a migration and not just scripts/backfill-payment-payee.mjs:
-- salon revenue becomes `payeeStaffId IS NULL` the moment the new code runs.
-- Every pre-existing row is NULL, so an independent's past payments would be
-- counted as the salon's until someone remembered to run the script. On
-- 18/09/2026 that was 4 of Julie Schoemans' appointments, 185 €, showing in
-- the Dashboard, the Rapports and the Livre de recettes. The rule is that her
-- money must never appear there at all, so there cannot be a window.
--
-- Same rules as the script, which stays for reporting and for anything this
-- deliberately refuses to touch:
--   * an owner is a Staff of type INDEPENDENT who is not the salon itself
--     (an ADMIN/OWNER account, or the till cash operator — Marie, whose VAT
--     is the salon's);
--   * an appointment belongs to its practitioner, an atelier/formation seat
--     to its session's animator (falling back to the activity's own);
--   * a payment is NEVER relabelled when something already says it was the
--     salon's — a salon invoice or ticket number is a legal statement that
--     cannot be taken back, and a pre-switch activity seat charged on the
--     salon's own Stripe (transactionReference set) is the salon's money
--     wherever it is now booked. Those rows stay NULL and the script lists
--     them for a human.

-- ── 1. Animator -> Staff, replacing the e-mail match ────────────────────────
-- DISTINCT ON makes the pick deterministic: prod has two User rows sharing
-- contact@meribeautystudio.com, and an arbitrary choice here would decide
-- whose Stripe account an activity is charged to.
UPDATE "animators" AS a
SET "staffId" = pick.staff_id
FROM (
  SELECT DISTINCT ON (an.id)
         an.id AS animator_id,
         s.id  AS staff_id
  FROM "animators" an
  JOIN "User"  u ON lower(u.email) = lower(an.email)
  JOIN "Staff" s ON s."userId" = u.id AND s."isDeleted" = false
  WHERE an."staffId" IS NULL
    AND an.email IS NOT NULL
  ORDER BY an.id, s."isActive" DESC, u."isActive" DESC, s.id
) AS pick
WHERE a.id = pick.animator_id
  -- animators.staffId is UNIQUE: never let a second animator claim a staff
  -- profile another one already holds.
  AND NOT EXISTS (SELECT 1 FROM "animators" other WHERE other."staffId" = pick.staff_id);

-- ── 2. Payment -> its owner ─────────────────────────────────────────────────
WITH salon_staff AS (
  SELECT s.id
  FROM "Staff" s
  JOIN "User" u ON u.id = s."userId"
  WHERE s."isDeleted" = false
    AND (u.role IN ('ADMIN', 'OWNER') OR lower(u.email) = 'contact@meribeautystudio.com')
),
independent AS (
  SELECT s.id
  FROM "Staff" s
  WHERE s.type = 'INDEPENDENT'
    AND s.id NOT IN (SELECT id FROM salon_staff)
),
owned AS (
  -- An appointment has always been a direct charge on the practitioner's own
  -- connected account, so it can never have landed on the salon's Stripe.
  SELECT p.id AS payment_id, ap."staffId" AS staff_id, false AS charged_to_platform
  FROM "Payment" p
  JOIN "Appointment" ap ON ap.id = p."appointmentId"
  WHERE p."payeeStaffId" IS NULL

  UNION ALL

  SELECT p.id, COALESCE(sess_an."staffId", parent_an."staffId"),
         p."transactionReference" IS NOT NULL
  FROM "Payment" p
  JOIN "workshop_reservations" r ON r.id = p."workshopReservationId"
  JOIN "workshop_sessions" ws ON ws.id = r."sessionId"
  JOIN "workshops" w ON w.id = ws."workshopId"
  LEFT JOIN "animators" sess_an   ON sess_an.id   = ws."animatorId"
  LEFT JOIN "animators" parent_an ON parent_an.id = w."animatorId"
  WHERE p."payeeStaffId" IS NULL

  UNION ALL

  SELECT p.id, COALESCE(sess_an."staffId", parent_an."staffId"),
         p."transactionReference" IS NOT NULL
  FROM "Payment" p
  JOIN "formation_reservations" r ON r.id = p."formationReservationId"
  JOIN "formation_sessions" fs ON fs.id = r."sessionId"
  JOIN "formations" f ON f.id = fs."formationId"
  LEFT JOIN "animators" sess_an   ON sess_an.id   = fs."animatorId"
  LEFT JOIN "animators" parent_an ON parent_an.id = f."animatorId"
  WHERE p."payeeStaffId" IS NULL
)
UPDATE "Payment" p
SET "payeeStaffId" = owned.staff_id
FROM owned
LEFT JOIN "Invoice" inv ON inv."paymentId" = owned.payment_id
WHERE p.id = owned.payment_id
  AND owned.staff_id IS NOT NULL
  AND owned.staff_id IN (SELECT id FROM independent)
  AND owned.charged_to_platform = false
  AND p."ticketNumber" IS NULL
  AND inv.id IS NULL;
