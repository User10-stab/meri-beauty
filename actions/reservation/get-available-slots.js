"use server";

import { prisma } from "@/lib/prisma";

function formatDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function isDateInRange(date, start, end) {
  const normalizedDate = new Date(date);
  normalizedDate.setHours(0, 0, 0, 0);
  const normalizedStart = new Date(start);
  normalizedStart.setHours(0, 0, 0, 0);
  const normalizedEnd = new Date(end);
  normalizedEnd.setHours(23, 59, 59, 999);
  return normalizedDate >= normalizedStart && normalizedDate <= normalizedEnd;
}

function buildAvailabilityForDate({ staffService, selectedDate, salon, existingAppointments }) {
  const dayMap = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];
  const weekDay = dayMap[selectedDate.getDay()];

  // Check if staff is active and not deleted
  if (!staffService.staff.isActive || staffService.staff.isDeleted) {
    return {
      isAvailable: false,
      slots: [],
      isWorkingDay: false,
      reason: "Staff not available",
    };
  }

  // Check if user is not deleted
  if (staffService.staff.user?.isDeleted) {
    return {
      isAvailable: false,
      slots: [],
      isWorkingDay: false,
      reason: "User deleted",
    };
  }

  // Check if staff has working hours configured
  if (!staffService.staff.workingHours || staffService.staff.workingHours.length === 0) {
    return {
      isAvailable: false,
      slots: [],
      isWorkingDay: false,
      reason: "No working hours configured",
    };
  }

  // Check if staff has an active contract
  const activeContract = staffService.staff.contracts?.find((c) => c.status === "ACTIVE");
  if (!activeContract) {
    return {
      isAvailable: false,
      slots: [],
      isWorkingDay: false,
      reason: "No active contract",
    };
  }

  // Check contract start date
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

  // Check contract end date
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

  // Check salon working days
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

/**
 * Get available time slots for a staff member on a specific date
 * @param {string} staffServiceId - The staff service ID
 * @param {Date} date - The date to check
 * @returns {Promise<{success: boolean, data?: any, message?: string}>}
 */
export async function getAvailableSlots(staffServiceId, date) {
  try {
    if (!staffServiceId || !date) {
      return {
        success: false,
        message: "Paramètres manquants",
      };
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
      return {
        success: false,
        message: "Service du personnel introuvable",
      };
    }

    const selectedDate = new Date(date);
    selectedDate.setHours(0, 0, 0, 0);

    const salon = await prisma.salon.findFirst({
      include: {
        closures: true,
        workingDays: true,
      },
    });

    const startOfDay = new Date(selectedDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(selectedDate);
    endOfDay.setHours(23, 59, 59, 999);

    const existingAppointments = await prisma.appointment.findMany({
      where: {
        staffServiceId,
        date: {
          gte: startOfDay,
          lte: endOfDay,
        },
        status: {
          in: ["PENDING", "CONFIRMED"],
        },
        isDeleted: false,
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
        slots: availability.slots,
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

export async function getMonthAvailability(staffServiceId, monthDate) {
  try {
    if (!staffServiceId || !monthDate) {
      return {
        success: false,
        message: "Paramètres manquants",
      };
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
      return {
        success: false,
        message: "Service du personnel introuvable",
      };
    }

    const startOfMonth = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
    const endOfMonth = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0);
    startOfMonth.setHours(0, 0, 0, 0);
    endOfMonth.setHours(23, 59, 59, 999);

    const salon = await prisma.salon.findFirst({
      include: {
        closures: true,
        workingDays: true,
      },
    });

    const existingAppointments = await prisma.appointment.findMany({
      where: {
        staffServiceId,
        date: {
          gte: startOfMonth,
          lte: endOfMonth,
        },
        status: {
          in: ["PENDING", "CONFIRMED"],
        },
        isDeleted: false,
      },
    });

    const unavailableDates = [];
    const cursor = new Date(startOfMonth);

    while (cursor <= endOfMonth) {
      const dayAppointments = existingAppointments.filter((appointment) => {
        const appointmentDate = new Date(appointment.date);
        return (
          appointmentDate.getFullYear() === cursor.getFullYear() &&
          appointmentDate.getMonth() === cursor.getMonth() &&
          appointmentDate.getDate() === cursor.getDate()
        );
      });

      const availability = buildAvailabilityForDate({
        staffService,
        selectedDate: new Date(cursor),
        salon,
        existingAppointments: dayAppointments,
      });

      if (!availability.isAvailable) {
        unavailableDates.push(formatDateKey(cursor));
      }

      cursor.setDate(cursor.getDate() + 1);
    }

    return {
      success: true,
      data: {
        unavailableDates,
      },
    };
  } catch (error) {
    console.error("[getMonthAvailability]", error);
    return {
      success: false,
      message: "Erreur lors de la récupération des disponibilités du mois",
    };
  }
}
