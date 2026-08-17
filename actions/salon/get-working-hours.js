"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { isAdminRole } from "@/lib/authorization";

export async function getWorkingHours() {
  try {
    const session = await auth();
    if (!session?.user || !isAdminRole(session.user.role)) {
      return { success: false, message: "Permissions insuffisantes", data: [] };
    }
    const salon = await prisma.salon.findUnique({ where: { id: "main-salon" } });
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
