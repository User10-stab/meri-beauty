"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

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

    const categories = await prisma.category.findMany({
      orderBy: { name: "asc" },
      include: {
        services: {
          select: {
            id: true,
            name: true,
            _count: { select: { staffServices: { where: { isActive: true } } } },
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
