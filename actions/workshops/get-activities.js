"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { serializeDecimalFields } from "@/lib/serialize-prisma";
import { isAdminRole } from "@/lib/authorization";

/**
 * Récupère toutes les activités (workshops et événements) pour le tableau de bord.
 * Réservé aux administrateurs et propriétaires.
 */
export async function getActivities() {
  try {
    const session = await auth();

    if (!session?.user || !isAdminRole(session.user.role)) {
      return {
        success: false,
        data: [],
        message: "Non autorisé. Accès réservé aux administrateurs.",
      };
    }

    const activities = await prisma.activity.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        animator: true,
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
