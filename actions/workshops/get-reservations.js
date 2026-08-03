"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { serializeDecimalFields } from "@/lib/serialize-prisma";
import { hasPermission, DASHBOARD_PERMISSIONS } from "@/lib/authorization";

/**
 * Récupère toutes les réservations de workshops/événements pour le tableau
 * de bord. Admin et staff voient toutes les ateliers, sans filtrage par
 * créateur — seules les actions de suppression/modification sont
 * restreintes aux administrateurs (voir manage-reservation.js).
 */
export async function getWorkshopReservations() {
  try {
    const session = await auth();

    if (!session?.user || !hasPermission(session.user.role, DASHBOARD_PERMISSIONS.WORKSHOP_RESERVATIONS)) {
      return { success: false, data: [], message: "Non autorisé." };
    }

    const reservations = await prisma.workshopReservation.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        session: { include: { workshop: { include: { sessions: true } } } },
        customer: { select: { id: true, fullName: true, email: true, phone: true } },
        payment: true,
      },
    });

    return { success: true, data: serializeDecimalFields(reservations) };
  } catch (error) {
    console.error("[getWorkshopReservations]", error);
    return { success: false, data: [], message: "Impossible de charger les réservations." };
  }
}
