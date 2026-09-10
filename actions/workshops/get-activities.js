"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { serializeDecimalFields } from "@/lib/serialize-prisma";
import { hasDashboardPermission, STAFF_PERMISSIONS } from "@/lib/authorization";
import { sessionOccupancyByIds, OCCUPANCY_KINDS } from "@/lib/reservations/session-occupancy";

/**
 * Récupère toutes les activités (workshops et événements) pour le tableau de bord.
 * Accessible au staff et aux administrateurs — le staff voit toutes les
 * activités (y compris celles créées par d'autres), mais ne peut modifier/
 * supprimer que les siennes (voir requireActivityAccess dans create-activity.js).
 */
export async function getActivities() {
  try {
    const session = await auth();

    if (!session?.user || !(await hasDashboardPermission(session.user, STAFF_PERMISSIONS.WORKSHOPS))) {
      return {
        success: false,
        data: [],
        message: "Non autorisé.",
      };
    }

    const activities = await prisma.activity.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        animator: true,
        sessions: { orderBy: { startDate: "asc" } },
      },
    });

    const sessionIds = activities.flatMap((activity) => activity.sessions.map((s) => s.id));
    const occupancy = await sessionOccupancyByIds(prisma, { kind: OCCUPANCY_KINDS.WORKSHOP, sessionIds });

    // Prochaine séance programmée (non annulée) de chaque activité, avec ses
    // places restantes — c'est ce que la liste admin affiche, une activité
    // pouvant avoir plusieurs séances à des capacités différentes.
    const withSeats = activities.map((activity) => {
      const upcoming = activity.sessions
        .filter((s) => s.status === "SCHEDULED")
        .map((s) => ({
          id: s.id,
          startDate: s.startDate,
          capacitySeats: s.capacity,
          remainingSeats: s.capacity - (occupancy.get(s.id) ?? 0),
        }));

      return {
        ...activity,
        nextSession: upcoming[0] ?? null,
        upcomingSessionsCount: upcoming.length,
      };
    });

    // Sérialisation des champs Decimal (comme le prix) pour éviter les erreurs Next.js
    const serializedData = withSeats.map((activity) => serializeDecimalFields(activity));

    return { success: true, data: serializedData };
  } catch (error) {
    console.error("[getActivities]", error);
    return {
      success: false,
      data: [],
      message: "Impossible de charger les activités.",
    };
  }
}
