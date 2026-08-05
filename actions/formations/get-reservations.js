"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { serializeDecimalFields } from "@/lib/serialize-prisma";
import { hasPermission, DASHBOARD_PERMISSIONS } from "@/lib/authorization";

/**
 * Récupère toutes les réservations de formations pour le tableau de bord.
 * Admin et staff voient toutes les formations, sans filtrage par créateur.
 * Contrairement aux ateliers, il n'y a toujours pas de changement de
 * séance/places pour les formations — seule l'annulation admin existe
 * (actions/formations/manage-reservation.js), en tant qu'outil interne, pas
 * une fonctionnalité self-service côté client.
 */
export async function getFormationReservations() {
  try {
    const session = await auth();

    if (!session?.user || !hasPermission(session.user.role, DASHBOARD_PERMISSIONS.FORMATION_RESERVATIONS)) {
      return { success: false, data: [], message: "Non autorisé." };
    }

    const reservations = await prisma.formationReservation.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        session: { include: { formation: true } },
        customer: { select: { id: true, fullName: true, email: true, phone: true } },
        payment: true,
      },
    });

    return { success: true, data: serializeDecimalFields(reservations) };
  } catch (error) {
    console.error("[getFormationReservations]", error);
    return { success: false, data: [], message: "Impossible de charger les réservations." };
  }
}
