"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { serializeDecimalFields } from "@/lib/serialize-prisma";
import { hasDashboardPermission, STAFF_PERMISSIONS } from "@/lib/authorization";

/**
 * Récupère toutes les entrées de liste d'attente pour le tableau de bord.
 * Lecture seule pour admin et staff — aucune mutation n'est exposée ici.
 */
export async function getWaitingListEntries() {
  try {
    const session = await auth();

    if (!session?.user || !(await hasDashboardPermission(session.user, STAFF_PERMISSIONS.WORKSHOP_RESERVATIONS))) {
      return { success: false, data: [], message: "Non autorisé." };
    }

    const entries = await prisma.waitingListEntry.findMany({
      orderBy: [{ sessionId: "asc" }, { position: "asc" }],
      include: {
        session: { include: { workshop: true } },
        customer: { select: { id: true, fullName: true, email: true, phone: true } },
      },
    });

    return { success: true, data: serializeDecimalFields(entries) };
  } catch (error) {
    console.error("[getWaitingListEntries]", error);
    return { success: false, data: [], message: "Impossible de charger la liste d'attente." };
  }
}
