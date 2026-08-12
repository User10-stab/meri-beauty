-- The site tells customers a late-cancellation deposit "reste acquis sauf
-- annulation exceptionnelle approuvée par l'administration" (see
-- MyAppointmentsPageClient.jsx / MyReservationsClient.jsx). The code
-- previously defaulted Staff.depositForfeitPercentage to 0, which made
-- rejectAppointment refund the deposit in full on every late cancellation
-- regardless of that promise — only an admin-approved exception
-- (waiveDepositForfeit: true) was meant to produce a full refund.
--
-- Change the default going forward, and backfill every existing Staff row:
-- all of them are still sitting on the untouched 0 default (verified against
-- the live DB before writing this migration), so this is a pure bug fix,
-- not overwriting anyone's deliberate choice.
ALTER TABLE "Staff" ALTER COLUMN "depositForfeitPercentage" SET DEFAULT 100;

UPDATE "Staff" SET "depositForfeitPercentage" = 100 WHERE "depositForfeitPercentage" = 0;
