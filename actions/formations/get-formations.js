"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { serializeDecimalFields } from "@/lib/serialize-prisma";
import { hasDashboardPermission, STAFF_PERMISSIONS } from "@/lib/authorization";
import { sessionOccupancyByIds, OCCUPANCY_KINDS } from "@/lib/reservations/session-occupancy";

/**
 * Récupère toutes les formations pour le tableau de bord.
 * OWNER/ADMIN voient tout. Un STAFF voit les formations qu'il a créées ou
 * qui lui sont assignées comme animatrice, y compris sur une session.
 */
export async function getFormations() {
  try {
    const session = await auth();

    if (!session?.user || !(await hasDashboardPermission(session.user, STAFF_PERMISSIONS.FORMATIONS))) {
      return {
        success: false,
        data: [],
        message: "Non autorisé.",
      };
    }

    const formations = await prisma.formation.findMany({
      where:
        session.user.role === "STAFF"
          ? {
              OR: [
                { createdById: session.user.id },
                ...(session.user.email ? [{ animator: { email: session.user.email } }] : []),
                ...(session.user.email ? [{ sessions: { some: { animator: { email: session.user.email } } } }] : []),
              ],
            }
          : {},
      orderBy: { createdAt: "desc" },
      include: {
        animator: true,
        sessions: { include: { animator: true }, orderBy: { startDate: "asc" } },
      },
    });

    const sessionIds = formations.flatMap((formation) => formation.sessions.map((s) => s.id));
    const occupancy = await sessionOccupancyByIds(prisma, { kind: OCCUPANCY_KINDS.FORMATION, sessionIds });

    const serializedData = formations.map((formation) => {
      const isAssigned = Boolean(
        session.user.email &&
          (formation.animator?.email === session.user.email ||
            formation.sessions.some((item) => item.animator?.email === session.user.email))
      );
      const canEdit = session.user.role !== "STAFF" || formation.createdById === session.user.id || isAssigned;
      const canDelete = session.user.role !== "STAFF" || formation.createdById === session.user.id;

      // Prochaine séance programmée (non annulée), avec ses places restantes
      // — une formation PUBLIC peut avoir plusieurs séances à des capacités
      // différentes.
      const upcoming = formation.sessions
        .filter((s) => s.status === "SCHEDULED")
        .map((s) => ({
          id: s.id,
          startDate: s.startDate,
          capacitySeats: s.capacity,
          remainingSeats: s.capacity - (occupancy.get(s.id) ?? 0),
        }));

      return {
        ...serializeDecimalFields(formation),
        canEdit,
        canDelete,
        nextSession: upcoming[0] ?? null,
        upcomingSessionsCount: upcoming.length,
      };
    });

    return { success: true, data: serializedData };
  } catch (error) {
    console.error("[getFormations]", error);
    return {
      success: false,
      data: [],
      message: "Impossible de charger les formations.",
    };
  }
}
