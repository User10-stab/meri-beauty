-- Prevents two non-cancelled appointments for the same staff service from
-- overlapping in time. This closes a race where two concurrent Stripe
-- webhook deliveries (checkout.session.completed) could both pass the
-- app-level "is this slot free?" check before either had committed its
-- appointment, and both go on to double-book the slot and charge two
-- customers. See app/api/webhooks/stripe/route.js processCheckoutSession.
--
-- This constraint is the actual guard from here on; the app-level findFirst
-- check stays only as a fast-path/friendly-error check for the common case.
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "Appointment"
  ADD CONSTRAINT "Appointment_no_overlap"
  EXCLUDE USING gist (
    "staffServiceId" WITH =,
    tsrange("startTime", "endTime") WITH &&
  )
  WHERE ("isDeleted" = false AND "status" IN ('PENDING', 'CONFIRMED'));
