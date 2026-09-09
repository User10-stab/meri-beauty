-- Set only by the manual, permission-gated send in
-- actions/payments/send-ticket-email.js — never by settleReservation or
-- completeAppointment, which stopped auto-e-mailing the ticket entirely.
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "ticketEmailedAt" TIMESTAMP(3);
