"use server";

import { prisma } from "@/lib/prisma";
import { ACTIVE_APPOINTMENT_STATUSES } from "@/lib/appointment-status";
import {
  startOfDay,
  buildPerDraftSlotsForDate,
  getSameDayProposalsForDate,
  toClientProposal,
} from "@/lib/reservation-scheduling-data";
import { DEFAULT_MAX_PROPOSALS } from "@/lib/same-day-scheduling";

/**
 * Find same-day sequential schedule proposals for all appointment drafts on a given date.
 */
export async function getSameDaySchedule({ drafts, date, maxProposals = DEFAULT_MAX_PROPOSALS }) {
  try {
    if (!drafts?.length || !date) {
      return { success: false, message: "Paramètres manquants." };
    }

    const selectedDate = startOfDay(new Date(date));
    const endOfDay = new Date(selectedDate);
    endOfDay.setHours(23, 59, 59, 999);

    const staffServiceIds = drafts.map((d) => d.staffService.id);

    const [salon, staffServices] = await Promise.all([
      prisma.salon.findUnique({ where: { id: "main-salon" }, include: { closures: true, workingDays: true } }),
      prisma.staffService.findMany({
        where: { id: { in: staffServiceIds }, isDeleted: false },
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

    const allAppointments = await prisma.appointment.findMany({
      where: {
        staffService: {
          staffId: { in: staffServices.map((ss) => ss.staffId) },
        },
        date: { gte: selectedDate, lte: endOfDay },
        status: { in: ACTIVE_APPOINTMENT_STATUSES },
        isDeleted: false,
      },
      include: {
        staffService: {
          select: {
            id: true,
            staffId: true,
            margin: true,
          },
        },
      },
    });

    const ssById = Object.fromEntries(staffServices.map((ss) => [ss.id, ss]));
    const apptsByStaffId = staffServices.reduce((acc, ss) => {
      acc[ss.staffId] = allAppointments.filter((a) => a.staffService?.staffId === ss.staffId);
      return acc;
    }, {});

    const ctx = {
      drafts,
      selectedDate,
      salon,
      ssById,
      apptsByStaffId,
      allAppointments,
      now: new Date(),
    };

    const { proposals, unavailable } = getSameDayProposalsForDate(ctx, { maxProposals });

    if (unavailable.length > 0) {
      return { success: true, proposals: [], schedule: null, unavailable };
    }

    if (proposals.length === 0) {
      return {
        success: true,
        proposals: [],
        schedule: null,
        unavailable: [],
        message: "Aucune combinaison de créneaux disponible ce jour pour tous les rendez-vous.",
      };
    }

    const clientProposals = proposals.map((p, i) =>
      toClientProposal({ ...p, recommended: i === 0 })
    );
    const schedule = clientProposals[0].appointments;

    return { success: true, proposals: clientProposals, schedule, unavailable: [] };
  } catch (error) {
    console.error("[getSameDaySchedule]", error);
    return { success: false, message: "Erreur lors du calcul des disponibilités." };
  }
}
