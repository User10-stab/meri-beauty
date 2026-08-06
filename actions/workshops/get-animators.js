"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { isAdminRole } from "@/lib/authorization";

/**
 * Récupère tous les animateurs externes.
 * Réservé aux administrateurs et propriétaires.
 */
export async function getAnimators() {
  try {
    const session = await auth();

    if (!session?.user || !isAdminRole(session.user.role)) {
      return {
        success: false,
        data: [],
        message: "Non autorisé. Accès réservé aux administrateurs.",
      };
    }

    const animators = await prisma.animator.findMany({
      orderBy: { name: "asc" },
    });

    return { success: true, data: animators };
  } catch (error) {
    console.error("[getAnimators]", error);
    return {
      success: false,
      data: [],
      message: "Impossible de charger les animateurs.",
    };
  }
}
