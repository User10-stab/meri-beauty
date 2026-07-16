"use server";

import { prisma } from "@/lib/prisma";

/**
 * Returns all categories with their service count.
 *
 * @returns {{ success: boolean, data: Array<{ id, name, description, servicesCount }>, message?: string }}
 */
export async function getCategories() {
  try {
    const categories = await prisma.category.findMany({
      orderBy: { name: "asc" },
      include: {
        services: {
          select: {
            id: true,
            name: true,
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
      services: c.services.map((s) => ({ id: s.id, name: s.name })),
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
