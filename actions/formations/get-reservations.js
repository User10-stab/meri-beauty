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
 * Récupère toutes les réservations de formations pour le tableau de bord.
 * OWNER/ADMIN voient tout; STAFF voit uniquement les réservations des
 * formations/séances dont il est responsable.
 * Contrairement aux ateliers, il n'y a toujours pas de changement de
 * séance/places pour les formations — seule l'annulation admin existe
 * (actions/formations/manage-reservation.js), en tant qu'outil interne, pas
 * une fonctionnalité self-service côté client.
 */
export async function getFormationReservations() {
  try {
    const session = await auth();

    if (!session?.user || !(await hasDashboardPermission(session.user, STAFF_PERMISSIONS.FORMATION_RESERVATIONS))) {
      return { success: false, data: [], message: "Non autorisé." };
    }

    const [reservations, capabilities] = await Promise.all([
      prisma.formationReservation.findMany({
        where: session.user.role === "STAFF"
          ? activityReservationStaffScope(ACTIVITY_RESERVATION_KINDS.FORMATION, session.user)
          : {},
      orderBy: { createdAt: "desc" },
      include: {
        session: { include: { formation: true } },
        customer: { select: { id: true, fullName: true, email: true, phone: true } },
        payment: true,
      },
      }),
      getActivityReservationCapabilities(session.user),
    ]);

    const sessionIds = [...new Set(reservations.map((r) => r.session?.id).filter(Boolean))];
    const occupancy = await sessionOccupancyByIds(prisma, { kind: OCCUPANCY_KINDS.FORMATION, sessionIds });

    return {
      success: true,
      data: serializeDecimalFields(reservations).map((reservation) => {
        const { session: reservationSession } = reservation;
        const capacity = reservationSession?.capacity ?? reservationSession?.formation?.capacity ?? null;
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
    console.error("[getFormationReservations]", error);
    return { success: false, data: [], message: "Impossible de charger les réservations." };
  }
}
