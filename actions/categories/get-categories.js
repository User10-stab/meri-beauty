"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { ROLES } from "@/lib/authorization";

/**
 * Returns all categories.
 * Categories are shared data accessible to all authenticated staff members.
 *
 * @returns {{ success: boolean, data: Array<{ id, name, description, servicesCount }>, message?: string }}
 */
export async function getCategories() {
  try {
    const session = await auth();

    if (!session?.user) {
      return { success: false, data: [], message: "Non authentifié" };
    }

    // For STAFF users, determine their staff ID to check which services they're already assigned to
    let currentStaffId = null;
    if (session.user.role === ROLES.STAFF) {
      const staff = await prisma.staff.findUnique({
        where: { userId: session.user.id, isDeleted: false },
        select: { id: true },
      });
      currentStaffId = staff?.id ?? null;
    }

    const categories = await prisma.category.findMany({
      orderBy: { name: "asc" },
      include: {
        services: {
          select: {
            id: true,
            name: true,
            _count: { select: { staffServices: { where: { isActive: true } } } },
            staffServices: currentStaffId
              ? {
                  where: { staffId: currentStaffId, isActive: true },
                  select: { id: true },
                }
              : false,
          },
          orderBy: { name: "asc" },
        },
      },
    });

    const data = categories.map((c) => ({
      id: c.id,
      name: c.name,
      description: c.description ?? null,
      servicesCount: c.services.length,
      services: c.services.map((s) => ({
        id: s.id,
        name: s.name,
        staffServicesCount: s._count.staffServices,
        isAssignedToMe: currentStaffId ? s.staffServices.length > 0 : false,
      })),
    }));

    return { success: true, data };
  } catch (error) {
    console.error("[getCategories]", error);
    return {
      success: false,
      data: [],
      message: "Impossible de charger les catégories.",
    };
  }
}
