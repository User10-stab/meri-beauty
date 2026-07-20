"use server";

import { prisma } from "@/lib/prisma";

export async function getWorkingHours() {
  try {
    const salon = await prisma.salon.findFirst();
    if (!salon) {
      return { success: true, data: [] };
    }

    const workingDays = await prisma.salonWorkingDay.findMany({
      where: { salonId: salon.id },
      orderBy: { day: "asc" },
    });

    return {
      success: true,
      data: workingDays.map((wd) => ({
        ...wd,
      })),
    };
  } catch (error) {
    console.error("[getWorkingHours]", error);
    return { success: false, message: "Impossible de charger les horaires.", data: [] };
  }
}