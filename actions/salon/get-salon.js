"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { isAdminRole } from "@/lib/authorization";

export async function getSalon() {
  try {
   
    const salon = await prisma.salon.findUnique({
      where: { id: "main-salon" },
      include: {
        workingDays: { orderBy: { day: "asc" } },
        closures: { orderBy: { startDate: "desc" } },
      },
    });

    if (!salon) return { success: true, data: null };

    return {
      success: true,
      data: {
        ...salon,
        createdAt: salon.createdAt.toISOString(),
        updatedAt: salon.updatedAt.toISOString(),
        workingDays: salon.workingDays.map((wd) => ({
          ...wd,
        })),
        closures: salon.closures.map((c) => ({
          ...c,
          startDate: c.startDate.toISOString(),
          endDate: c.endDate?.toISOString() ?? null,
          createdAt: c.createdAt.toISOString(),
          updatedAt: c.updatedAt.toISOString(),
        })),
      },
    };
  } catch (error) {
    console.error("[getSalon]", error);
    return { success: false, message: "Impossible de charger les informations du salon.", data: null };
  }
}
