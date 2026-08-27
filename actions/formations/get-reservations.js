"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { serializeDecimalFields } from "@/lib/serialize-prisma";
import { hasDashboardPermission, STAFF_PERMISSIONS } from "@/lib/authorization";

/**
 * Récupère toutes les réservations de formations pour le tableau de bord.
 * OWNER/ADMIN voient tout; STAFF voit uniquement les réservations de ses formations.
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

    const reservations = await prisma.formationReservation.findMany({
      where: session.user.role === "STAFF"
        ? { session: { formation: { createdById: session.user.id } } }
        : {},
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
