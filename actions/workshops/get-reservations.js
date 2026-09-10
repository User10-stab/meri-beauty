"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { serializeDecimalFields } from "@/lib/serialize-prisma";
import { hasDashboardPermission, STAFF_PERMISSIONS } from "@/lib/authorization";
import {
  ACTIVITY_RESERVATION_KINDS,
  activityReservationStaffScope,
  getActivityReservationCapabilities,
} from "@/lib/activity-reservation-access";
import { sessionOccupancyByIds, OCCUPANCY_KINDS } from "@/lib/reservations/session-occupancy";

/**
 * Récupère toutes les réservations de workshops/événements pour le tableau
 * de bord. Admin voit tout; le staff voit seulement les réservations des
 * ateliers/événements et séances dont il est responsable.
 */
export async function getWorkshopReservations() {
  try {
    const session = await auth();

    if (!session?.user || !(await hasDashboardPermission(session.user, STAFF_PERMISSIONS.WORKSHOP_RESERVATIONS))) {
      return { success: false, data: [], message: "Non autorisé." };
    }

    const [reservations, capabilities] = await Promise.all([
      prisma.workshopReservation.findMany({
        where: session.user.role === "STAFF"
          ? activityReservationStaffScope(ACTIVITY_RESERVATION_KINDS.WORKSHOP, session.user)
          : {},
        orderBy: { createdAt: "desc" },
        include: {
          session: { include: { workshop: { include: { sessions: true } } } },
          customer: { select: { id: true, fullName: true, email: true, phone: true } },
          payment: true,
        },
      }),
      getActivityReservationCapabilities(session.user),
    ]);

    const sessionIds = [...new Set(reservations.map((r) => r.session?.id).filter(Boolean))];
    const occupancy = await sessionOccupancyByIds(prisma, { kind: OCCUPANCY_KINDS.WORKSHOP, sessionIds });

    return {
      success: true,
      data: serializeDecimalFields(reservations).map((reservation) => {
        const { session: reservationSession } = reservation;
        const capacity = reservationSession?.capacity ?? reservationSession?.workshop?.capacity ?? null;
        const taken = reservationSession ? occupancy.get(reservationSession.id) ?? 0 : 0;
        return {
          ...reservation,
          ...capabilities,
          session: reservationSession
            ? { ...reservationSession, capacitySeats: capacity, remainingSeats: capacity != null ? capacity - taken : null }
            : reservationSession,
        };
      }),
    };
  } catch (error) {
    console.error("[getWorkshopReservations]", error);
    return { success: false, data: [], message: "Impossible de charger les réservations." };
  }
}
