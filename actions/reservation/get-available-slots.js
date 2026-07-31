"use server";

import { prisma } from "@/lib/prisma";
import { buildAvailabilityForDate } from "@/lib/slot-availability";

function formatDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
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
