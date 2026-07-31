"use server";

import { prisma } from "@/lib/prisma";
import {
  startOfDay,
  addDays,
  findNearestSingleSlots,
  findNearestSameDaySchedules,
  findNearestMultiDaySchedules,
} from "@/lib/reservation-scheduling-data";

const DEFAULT_MAX_PROPOSALS = 3;
const DEFAULT_MAX_DAYS = 60;

async function loadSchedulingContext(drafts, maxDaysToScan) {
  const now = new Date();
  const fromDate = startOfDay(now);
  const toDate = addDays(fromDate, maxDaysToScan);
  toDate.setHours(23, 59, 59, 999);

  const staffServiceIds = drafts.map((d) => d.staffService.id);

  const [salon, staffServices, allAppointments] = await Promise.all([
    prisma.salon.findFirst({ include: { closures: true, workingDays: true } }),
    prisma.staffService.findMany({
      where: { id: { in: staffServiceIds } },
      include: {
        staff: {
          include: {
            workingHours: true,
            timeOffs: true,
            contracts: { where: { status: "ACTIVE" }, take: 1 },
            user: { select: { isDeleted: true, isActive: true } },
          },
        },
      },
    }),
    prisma.appointment.findMany({
      where: {
        staffServiceId: { in: staffServiceIds },
        date: { gte: fromDate, lte: toDate },
        status: { in: ["PENDING", "CONFIRMED"] },
        isDeleted: false,
      },
      select: { staffServiceId: true, date: true, startTime: true, endTime: true },
    }),
  ]);

  return {
    now,
    salon,
    drafts,
    ssById: Object.fromEntries(staffServices.map((ss) => [ss.id, ss])),
    allAppointments,
  };
}

/**
 * Scan upcoming days and return the nearest available slot proposals.
 *
 * @param {{
 *   drafts: Array<{ staffService: { id: string, duration?: number } }>,
 *   schedulingMode?: "same-day" | "multi-day",
 *   maxProposals?: number,
 *   maxDaysToScan?: number,
 * }} params
 */
export async function findNearestAvailability({
  drafts,
  schedulingMode = "same-day",
  maxProposals = DEFAULT_MAX_PROPOSALS,
  maxDaysToScan = DEFAULT_MAX_DAYS,
}) {
  try {
    if (!drafts?.length) {
      return { success: false, message: "Paramètres manquants." };
    }

    const ctx = await loadSchedulingContext(drafts, maxDaysToScan);
    const opts = { maxProposals, maxDaysToScan };

    let proposals;
    let type;

    if (drafts.length === 1) {
      type = "single";
      proposals = findNearestSingleSlots(ctx, opts);
    } else if (schedulingMode === "multi-day") {
      type = "multi-day";
      proposals = findNearestMultiDaySchedules(ctx, opts);
    } else {
      type = "same-day";
      proposals = findNearestSameDaySchedules(ctx, opts);
    }

    if (proposals.length === 0) {
      return {
        success: true,
        type,
        proposals: [],
        message: "Aucun créneau disponible dans les prochaines semaines.",
      };
    }

    return { success: true, type, proposals };
  } catch (error) {
    console.error("[findNearestAvailability]", error);
    return { success: false, message: "Erreur lors de la recherche des créneaux." };
  }
}
