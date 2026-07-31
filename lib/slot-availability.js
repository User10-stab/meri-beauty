/**
 * Slot availability helpers — canonical business rules for date/slot generation.
 *
 * Used by get-available-slots and same-day scheduling. Add new rules here only.
 */

export function isDateInRange(date, start, end) {
  const normalizedDate = new Date(date);
  normalizedDate.setHours(0, 0, 0, 0);
  const normalizedStart = new Date(start);
  normalizedStart.setHours(0, 0, 0, 0);
  const normalizedEnd = new Date(end);
  normalizedEnd.setHours(23, 59, 59, 999);
  return normalizedDate >= normalizedStart && normalizedDate <= normalizedEnd;
}

/**
 * Build available time slots for a staff service on a specific date.
 *
 * @returns {{
 *   isAvailable: boolean,
 *   slots: Array<{ time: string, available: boolean, startMinutes: number, endMinutes: number }>,
 *   isWorkingDay: boolean,
 *   workingHours?: { start: string, end: string },
 *   reason: string | null,
 * }}
 */
export function buildAvailabilityForDate({ staffService, selectedDate, salon, existingAppointments }) {
  const dayMap = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];
  const weekDay = dayMap[selectedDate.getDay()];

  if (!staffService.staff.isActive || staffService.staff.isDeleted) {
    return {
      isAvailable: false,
      slots: [],
      isWorkingDay: false,
      reason: "Staff not available",
    };
  }

  if (staffService.staff.user?.isDeleted) {
    return {
      isAvailable: false,
      slots: [],
      isWorkingDay: false,
      reason: "User deleted",
    };
  }

  if (!staffService.staff.workingHours || staffService.staff.workingHours.length === 0) {
    return {
      isAvailable: false,
      slots: [],
      isWorkingDay: false,
      reason: "No working hours configured",
    };
  }

  const activeContract = staffService.staff.contracts?.find((c) => c.status === "ACTIVE");
  if (!activeContract) {
    return {
      isAvailable: false,
      slots: [],
      isWorkingDay: false,
      reason: "No active contract",
    };
  }

  const contractStart = new Date(activeContract.startDate);
  contractStart.setHours(0, 0, 0, 0);
  if (selectedDate < contractStart) {
    return {
      isAvailable: false,
      slots: [],
      isWorkingDay: false,
      reason: "Contract has not started yet",
    };
  }

  if (activeContract.endDate) {
    const contractEnd = new Date(activeContract.endDate);
    contractEnd.setHours(23, 59, 59, 999);
    if (selectedDate > contractEnd) {
      return {
        isAvailable: false,
        slots: [],
        isWorkingDay: false,
        reason: "Contract has expired",
      };
    }
  }

  if (salon && salon.workingDays) {
    const salonWorkingDay = salon.workingDays.find((wd) => wd.day === weekDay);
    if (!salonWorkingDay || !salonWorkingDay.isOpen) {
      return {
        isAvailable: false,
        slots: [],
        isWorkingDay: false,
        reason: "Salon closed this day",
      };
    }
  }

  const workingHour = staffService.staff.workingHours.find((wh) => wh.day === weekDay);

  if (!workingHour || workingHour.isClosed) {
    return {
      isAvailable: false,
      slots: [],
      isWorkingDay: false,
      reason: "Staff not working this day",
    };
  }

  const hasTimeOff = staffService.staff.timeOffs.some((timeOff) =>
    isDateInRange(selectedDate, timeOff.startDate, timeOff.endDate)
  );

  if (hasTimeOff) {
    return {
      isAvailable: false,
      slots: [],
      isWorkingDay: false,
      reason: "Staff on time off",
    };
  }

  if (salon) {
    const salonClosure = salon.closures.find((closure) => {
      const start = new Date(closure.startDate);
      const end = closure.endDate ? new Date(closure.endDate) : start;
      return isDateInRange(selectedDate, start, end);
    });

    if (salonClosure) {
      return {
        isAvailable: false,
        slots: [],
        isWorkingDay: false,
        reason: "Salon closure",
      };
    }
  }

  const slots = [];
  const duration = staffService.duration;
  const [startHour, startMinute] = workingHour.startTime.split(":").map(Number);
  const [endHour, endMinute] = workingHour.endTime.split(":").map(Number);

  let currentTime = startHour * 60 + startMinute;
  const endTime = endHour * 60 + endMinute;

  while (currentTime + duration <= endTime) {
    const hour = Math.floor(currentTime / 60);
    const minute = currentTime % 60;
    const timeString = `${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}`;

    const slotStart = new Date(selectedDate);
    slotStart.setHours(hour, minute, 0, 0);
    const slotEnd = new Date(slotStart);
    slotEnd.setMinutes(slotEnd.getMinutes() + duration);

    const isBooked = existingAppointments.some((apt) => {
      const aptStart = new Date(apt.startTime);
      const aptEnd = new Date(apt.endTime);
      return (
        (slotStart >= aptStart && slotStart < aptEnd) ||
        (slotEnd > aptStart && slotEnd <= aptEnd) ||
        (slotStart <= aptStart && slotEnd >= aptEnd)
      );
    });

    slots.push({
      time: timeString,
      available: !isBooked,
      startMinutes: currentTime,
      endMinutes: currentTime + duration,
    });

    currentTime += 30;
  }

  return {
    isAvailable: slots.some((slot) => slot.available),
    slots,
    isWorkingDay: true,
    workingHours: {
      start: workingHour.startTime,
      end: workingHour.endTime,
    },
    reason: null,
  };
}
