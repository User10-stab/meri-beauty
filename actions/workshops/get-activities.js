"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { serializeDecimalFields } from "@/lib/serialize-prisma";
import { hasDashboardPermission, STAFF_PERMISSIONS } from "@/lib/authorization";

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
        sessions: true,
      },
    });

    // Sérialisation des champs Decimal (comme le prix) pour éviter les erreurs Next.js
    const serializedData = activities.map((activity) => serializeDecimalFields(activity));

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
