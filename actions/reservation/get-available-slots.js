"use server";

import { prisma } from "@/lib/prisma";
import {
  buildAvailabilityForDate,
  parseLocalDateString,
  formatLocalDateKey,
} from "@/lib/slot-availability";

/**
 * Get available reservation windows for a staff member on a specific date.
 *
 * @param {string}        staffServiceId
 * @param {string|Date}   date  — "YYYY-MM-DD" string (preferred) or a Date object.
 *                                Always treated as a local calendar date; no UTC shift.
 * @param {string}        [excludeAppointmentId] - when rescheduling, the
 *   appointment's own (still-present, not-yet-moved) slot must be excluded
 *   from "existing appointments" — otherwise the grid shown here (still
 *   blocked by its old slot) can disagree with validateAppointmentSlot's
 *   grid (which does exclude it, see lib/appointment-scheduling.js), and a
 *   time offered here gets spuriously rejected on submit.
 */
export async function getAvailableSlots(staffServiceId, date, excludeAppointmentId = null) {
  try {
    if (!staffServiceId || !date) {
      return { success: false, message: "Paramètres manquants" };
    }

    const staffService = await prisma.staffService.findUnique({
      where: { id: staffServiceId },
      include: {
        staff: {
          include: {
            workingHours: true,
            timeOffs: true,
            contracts: true,
          },
        },
      },
    });

    if (!staffService) {
      return { success: false, message: "Service du personnel introuvable" };
    }

    // ── Use parseLocalDateString so the calendar day is preserved across
    //    the Server Action serialisation boundary (Date → ISO string → Date).
    const selectedDate = parseLocalDateString(date);

    const salon = await prisma.salon.findFirst({
      include: { closures: true, workingDays: true },
    });

    // Query ALL existing appointments for this staff member on the selected day.
    // A staff member cannot perform two services simultaneously, regardless of
    // which service was booked, so we must consider all their appointments.
    const startOfDay = parseLocalDateString(date);
    const endOfDay   = parseLocalDateString(date);
    endOfDay.setHours(23, 59, 59, 999);

    const existingAppointments = await prisma.appointment.findMany({
      where: {
        staffService: {
          staffId: staffService.staff.id,
        },
        date: { gte: startOfDay, lte: endOfDay },
        status: { in: ["PENDING", "CONFIRMED"] },
        isDeleted: false,
        ...(excludeAppointmentId ? { id: { not: excludeAppointmentId } } : {}),
      },
      include: {
        staffService: {
          select: {
            margin: true,
          },
        },
      },
    });

    const availability = buildAvailabilityForDate({
      staffService,
      selectedDate,
      salon,
      existingAppointments,
    });

    return {
      success: true,
      data: {
        reservationWindows: availability.reservationWindows,
        freeIntervals: availability.freeIntervals,
        occupiedIntervals: availability.occupiedIntervals,
        isWorkingDay: availability.isWorkingDay,
        workingHours: availability.workingHours,
        reason: availability.reason,
      },
    };
  } catch (error) {
    console.error("[getAvailableSlots]", error);
    return {
      success: false,
      message: "Erreur lors de la récupération des créneaux disponibles",
    };
  }
}

/**
 * Return a set of "YYYY-MM-DD" keys for every day in the month that has no
 * available slots (used by the calendar to grey-out unavailable dates).
 *
 * @param {string}  staffServiceId
 * @param {Date}    monthDate  — any Date whose month/year identify the target month.
 *                               This value comes from the client as a local Date and
 *                               is safe to use directly via getFullYear/getMonth.
 * @param {string}  [excludeAppointmentId] - see getAvailableSlots above; same
 *   reasoning applies here, otherwise the appointment being rescheduled can
 *   grey out its own current day as unavailable.
 */
export async function getMonthAvailability(staffServiceId, monthDate, excludeAppointmentId = null) {
  try {
    if (!staffServiceId || !monthDate) {
      return { success: false, message: "Paramètres manquants" };
    }

    const staffService = await prisma.staffService.findUnique({
      where: { id: staffServiceId },
      include: {
        staff: {
          include: {
            workingHours: true,
            timeOffs: true,
            contracts: true,
          },
        },
      },
    });

    if (!staffService) {
      return { success: false, message: "Service du personnel introuvable" };
    }

    // Build month boundaries using the local Date constructor so they are
    // anchored to local midnight, not UTC midnight.
    const year  = new Date(monthDate).getFullYear();
    const month = new Date(monthDate).getMonth();

    const startOfMonth = new Date(year, month, 1);          // local midnight 1st
    const endOfMonth   = new Date(year, month + 1, 0);      // local midnight last day
    endOfMonth.setHours(23, 59, 59, 999);

    const salon = await prisma.salon.findFirst({
      include: { closures: true, workingDays: true },
    });

    const existingAppointments = await prisma.appointment.findMany({
      where: {
        staffService: {
          staffId: staffService.staff.id,
        },
        date: { gte: startOfMonth, lte: endOfMonth },
        status: { in: ["PENDING", "CONFIRMED"] },
        isDeleted: false,
        ...(excludeAppointmentId ? { id: { not: excludeAppointmentId } } : {}),
      },
      include: {
        staffService: {
          select: {
            margin: true,
          },
        },
      },
    });

    const unavailableDates = [];
    const cursor = new Date(startOfMonth);

    while (cursor <= endOfMonth) {
      // Filter pre-loaded appointments to this exact calendar day using local
      // year/month/day comparison — avoids re-querying and UTC drift.
      const dayAppointments = existingAppointments.filter((appt) => {
        const d = new Date(appt.date);
        return (
          d.getFullYear() === cursor.getFullYear() &&
          d.getMonth()    === cursor.getMonth()    &&
          d.getDate()     === cursor.getDate()
        );
      });

      const availability = buildAvailabilityForDate({
        staffService,
        selectedDate: new Date(cursor), // cursor is already local midnight
        salon,
        existingAppointments: dayAppointments,
      });

      if (!availability.isAvailable) {
        // formatLocalDateKey reads local getFullYear/getMonth/getDate — no UTC shift
        unavailableDates.push(formatLocalDateKey(cursor));
      }

      cursor.setDate(cursor.getDate() + 1);
    }

    return { success: true, data: { unavailableDates } };
  } catch (error) {
    console.error("[getMonthAvailability]", error);
    return {
      success: false,
      message: "Erreur lors de la récupération des disponibilités du mois",
    };
  }
}
