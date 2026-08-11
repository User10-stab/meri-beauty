"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { isAdminRole } from "@/lib/authorization";
import { updateSalonSchema } from "@/lib/validations/salon";

export async function updateSalon(input) {
  const session = await auth();
  if (!session?.user || !isAdminRole(session.user.role)) {
    return { success: false, message: "Permissions insuffisantes" };
  }

  const parsed = updateSalonSchema.safeParse(input);
  if (!parsed.success) {
    const fe = parsed.error.flatten().fieldErrors;
    return {
      success: false,
      message: "Veuillez corriger les erreurs.",
      errors: Object.fromEntries(
        Object.entries(fe).map(([k, v]) => [k, v?.[0] ?? null]),
      ),
    };
  }

  try {
    const updatedSalon = await prisma.salon.upsert({
      where: { id: "main-salon" },
      update: parsed.data,
      create: { id: "main-salon", ...parsed.data },
      include: {
        workingDays: { orderBy: { day: "asc" } },
        closures: { orderBy: { startDate: "desc" } },
      },
    });

    revalidatePath("/dashboard/settings");
    return {
      success: true,
      message: "Informations du salon mises à jour.",
      data: {
        ...updatedSalon,
        createdAt: updatedSalon.createdAt.toISOString(),
        updatedAt: updatedSalon.updatedAt.toISOString(),
        workingDays: updatedSalon.workingDays.map((wd) => ({
          ...wd,
        })),
        closures: updatedSalon.closures.map((c) => ({
          ...c,
          startDate: c.startDate.toISOString(),
          endDate: c.endDate?.toISOString() ?? null,
          createdAt: c.createdAt.toISOString(),
          updatedAt: c.updatedAt.toISOString(),
        })),
      },
    };
  } catch (error) {
    console.error("[updateSalon]", error);
    return { success: false, message: "Une erreur est survenue." };
  }
}
