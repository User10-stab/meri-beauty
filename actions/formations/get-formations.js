"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { serializeDecimalFields } from "@/lib/serialize-prisma";
import { hasPermission, DASHBOARD_PERMISSIONS } from "@/lib/authorization";

/**
 * Récupère toutes les formations pour le tableau de bord.
 * Accessible au staff et aux administrateurs — le staff voit toutes les
 * formations (y compris celles créées par d'autres), mais ne peut modifier/
 * supprimer que les siennes (voir requireFormationAccess dans create-formation.js).
 */
export async function getFormations() {
  try {
    const session = await auth();

    if (!session?.user || !hasPermission(session.user.role, DASHBOARD_PERMISSIONS.FORMATIONS)) {
      return {
        success: false,
        data: [],
        message: "Non autorisé.",
      };
    }

    const formations = await prisma.formation.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        animator: true,
        sessions: true,
      },
    });

    const serializedData = formations.map((formation) => serializeDecimalFields(formation));

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
