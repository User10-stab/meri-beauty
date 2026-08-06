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

  // Load salon and staff services in parallel first, then use the resolved
  // staffIds to query ALL appointments for those staff members.
  // (allAppointments cannot be parallel with staffServices because it needs
  // the resolved staffId values from the staffServices rows.)
  const [salon, staffServices] = await Promise.all([
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
  ]);

  // Deduplicate staff IDs — a staff member shared across multiple drafts
  // must not be queried twice.
  const staffIds = [...new Set(staffServices.map((ss) => ss.staffId))];

  // Load ALL appointments for these staff members across the scan window.
  // We do not filter by staffServiceId because a staff member is busy
  // regardless of which service was booked.
  const allAppointments = await prisma.appointment.findMany({
    where: {
      staffService: {
        staffId: { in: staffIds },
      },
      date: { gte: fromDate, lte: toDate },
      status: { in: ["PENDING", "CONFIRMED"] },
      isDeleted: false,
    },
    include: {
      staffService: {
        select: {
          id: true,
          margin: true,
          staffId: true,
        },
      },
    },
  });

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
