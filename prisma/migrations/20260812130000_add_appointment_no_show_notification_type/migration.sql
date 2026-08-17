-- markAppointmentNoShow (actions/appointment/manage-appointment.js) needs its
-- own notification type — reusing APPOINTMENT_CANCELLED would misrepresent a
-- no-show as a cancellation, exactly the conflation this feature exists to fix.
ALTER TYPE "NotificationType" ADD VALUE 'APPOINTMENT_NO_SHOW';
