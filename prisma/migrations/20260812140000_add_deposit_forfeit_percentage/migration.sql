-- Default 0 == today's exact "always fully refunded" behaviour. Inert until
-- a staff member's percentage is set above zero — see rejectAppointment in
-- actions/appointment/manage-appointment.js.
ALTER TABLE "Staff" ADD COLUMN "depositForfeitPercentage" DECIMAL(5,2) NOT NULL DEFAULT 0;
