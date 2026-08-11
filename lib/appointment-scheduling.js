import { prisma } from "@/lib/prisma";
import { parseLocalDateString, buildAvailabilityForDate, hasReservationWindow } from "@/lib/slot-availability";

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

/**
 * Re-validates a submitted appointment slot against the same business rules
 * the booking UI uses to generate its pickable windows (see
 * actions/reservation/get-available-slots.js) — salon opening days, salon
 * closures, staff working hours, staff time off, active contract dates, and
 * no overlap with other appointments — plus a past-date/time check that the
 * read-only lookup path doesn't need.
 *
 * Without this, createReservation/createCheckoutSession only ran
 * findConflictingAppointment (collision with another appointment) and
 * accepted any other (date, time): a closed day, a staff member's day off,
 * or a time slot hours in the past would all be booked successfully as long
 * as nothing else already occupied that exact window.
 *
 * @param {string} staffServiceId
 * @param {Date} appointmentDate - local-midnight Date for the requested day
 * @param {Date} startTime - full Date/time of the requested window start
 * @param {string} time - "HH:mm", must match one of the generated windows
 * @param {string} [excludeAppointmentId] - skip this appointment when
 *   computing the day's occupied intervals, e.g. when rescheduling it to a
 *   new time on the same day — otherwise its own old slot would still count
 *   as occupied and could spuriously reject an otherwise-free new time.
 * @returns {Promise<{ valid: boolean, message?: string }>}
 */
export async function validateAppointmentSlot(staffServiceId, appointmentDate, startTime, time, excludeAppointmentId = null) {
  if (startTime.getTime() < Date.now()) {
    return { valid: false, message: "Ce créneau est déjà passé. Veuillez choisir un horaire à venir." };
  }

  const staffService = await prisma.staffService.findUnique({
    where: { id: staffServiceId },
    include: {
      staff: {
        include: {
          workingHours: true,
          timeOffs: true,
          contracts: true,
          user: { select: { isDeleted: true } },
        },
      },
    },
  });

  if (!staffService) {
    return { valid: false, message: "Service non disponible." };
  }

  const salon = await prisma.salon.findFirst({ include: { closures: true, workingDays: true } });

  const startOfDay = new Date(appointmentDate);
  const endOfDay = new Date(appointmentDate);
  endOfDay.setHours(23, 59, 59, 999);

  const existingAppointments = await prisma.appointment.findMany({
    where: {
      staffService: { staffId: staffService.staff.id },
      date: { gte: startOfDay, lte: endOfDay },
      status: { in: ["PENDING", "CONFIRMED"] },
      isDeleted: false,
      ...(excludeAppointmentId ? { id: { not: excludeAppointmentId } } : {}),
    },
    include: { staffService: { select: { margin: true } } },
  });

  const availability = buildAvailabilityForDate({
    staffService,
    selectedDate: appointmentDate,
    salon,
    existingAppointments,
  });

  if (!availability.isWorkingDay) {
    return { valid: false, message: "Ce créneau n'est plus disponible. Veuillez en sélectionner un autre." };
  }

  if (!hasReservationWindow(availability.reservationWindows, time)) {
    return { valid: false, message: "Ce créneau vient d'être réservé ou n'est plus disponible. Veuillez choisir un autre horaire." };
  }

  return { valid: true };
}
