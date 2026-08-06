import { prisma } from "@/lib/prisma";
import { parseLocalDateString } from "@/lib/slot-availability";

/**
 * Builds the date-only appointment date plus start/end Date objects for a
 * given calendar date, "HH:mm" time string, and service duration.
 *
 * Accepts either a "YYYY-MM-DD" string (preferred — timezone-safe) or a Date
 * object. Always uses parseLocalDateString so the calendar day is anchored to
 * local midnight, preventing UTC-offset drift when the value has been
 * serialised through a Server Action boundary.
 *
 * Shared by createReservation and rescheduleAppointment — kept out of any
 * "use server" file since Next.js requires every export of such a file to be
 * an async server action, and these are plain synchronous/query helpers.
 *
 * @param {Date|string} date
 * @param {string} time - "HH:mm"
 * @param {number} durationMinutes
 * @returns {{ appointmentDate: Date, startTime: Date, endTime: Date }}
 */
export function buildAppointmentWindow(date, time, durationMinutes) {
  const [hour, minute] = time.split(":").map(Number);

  const appointmentDate = parseLocalDateString(date);

  const startTime = new Date(appointmentDate);
  startTime.setHours(hour, minute, 0, 0);

  const endTime = new Date(startTime);
  endTime.setMinutes(endTime.getMinutes() + durationMinutes);

  return { appointmentDate, startTime, endTime };
}

/**
 * Checks whether an overlapping, still-active appointment already exists
 * for the given staff member and time window.
 *
 * Business rule: the conflict check is performed per staff member, not per
 * StaffService, and each existing appointment occupies its service duration
 * plus its own post-service margin.
 *
 * @param {string} staffServiceId
 * @param {Date} appointmentDate
 * @param {Date} startTime
 * @param {Date} endTime
 * @param {string} [excludeAppointmentId] - skip this appointment when checking
 *   for conflicts, e.g. when rescheduling it to a new time.
 * @returns {Promise<object|null>}
 */
export async function findConflictingAppointment(staffServiceId, appointmentDate, startTime, endTime, excludeAppointmentId = null) {
  const staffService = await prisma.staffService.findUnique({
    where: { id: staffServiceId },
    select: { staffId: true },
  });

  if (!staffService) {
    return null;
  }

  const appointments = await prisma.appointment.findMany({
    where: {
      staffService: {
        staffId: staffService.staffId,
      },
      date: appointmentDate,
      status: { in: ["PENDING", "CONFIRMED"] },
      isDeleted: false,
      ...(excludeAppointmentId ? { id: { not: excludeAppointmentId } } : {}),
    },
    include: {
      staffService: {
        select: { margin: true },
      },
    },
  });

  return (
    appointments.find((appointment) => {
      const occupiedStart = new Date(appointment.startTime);
      const occupiedEnd = new Date(appointment.endTime);
      occupiedEnd.setMinutes(
        occupiedEnd.getMinutes() + Number(appointment.staffService?.margin ?? 0)
      );

      return startTime < occupiedEnd && endTime > occupiedStart;
    }) ?? null
  );
}
