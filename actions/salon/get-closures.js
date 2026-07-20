"use server";

import { prisma } from "@/lib/prisma";

export async function getClosures() {
  try {
    const salon = await prisma.salon.findFirst();
    if (!salon) {
      return { success: true, data: [] };
    }

    const closures = await prisma.salonClosure.findMany({
      where: { salonId: salon.id },
      orderBy: { startDate: "desc" },
    });

    return {
      success: true,
      data: closures.map((c) => ({
        ...c,
        startDate: c.startDate.toISOString(),
        endDate: c.endDate?.toISOString() ?? null,
        createdAt: c.createdAt.toISOString(),
        updatedAt: c.updatedAt.toISOString(),
      })),
    };
  } catch (error) {
    console.error("[getClosures]", error);
    return { success: false, message: "Impossible de charger les fermetures.", data: [] };
  }
}