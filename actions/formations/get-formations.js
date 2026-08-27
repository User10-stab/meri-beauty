"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { serializeDecimalFields } from "@/lib/serialize-prisma";
import { hasDashboardPermission, STAFF_PERMISSIONS } from "@/lib/authorization";

/**
 * Récupère toutes les formations pour le tableau de bord.
 * OWNER/ADMIN voient tout. Un STAFF ne voit que les formations qu'il a créées.
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
      where: session.user.role === "STAFF" ? { createdById: session.user.id } : {},
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
