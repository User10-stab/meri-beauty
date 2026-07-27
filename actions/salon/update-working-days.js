"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { isAdminRole } from "@/lib/authorization";
import { updateWorkingDaysSchema } from "@/lib/validations/salon";

export async function updateWorkingDays(input) {
  const session = await auth();
  if (!session?.user || !isAdminRole(session.user.role)) {
    return { success: false, message: "Permissions insuffisantes" };
  }

  const parsed = updateWorkingDaysSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, message: "Veuillez corriger les erreurs dans les horaires." };
  }

  try {
    const salon = await prisma.salon.findFirst();
    if (!salon) {
      return { success: false, message: "Aucun salon trouvé. Enregistrez d'abord les informations du salon." };
    }

    await prisma.$transaction(async (tx) => {
      await tx.salonWorkingDay.deleteMany({ where: { salonId: salon.id } });
      await tx.salonWorkingDay.createMany({
        data: parsed.data.days.map((day) => ({
          salonId: salon.id,
          day: day.day,
          isOpen: day.isOpen,
          openingTime: day.isOpen ? day.openingTime : "",
          closingTime: day.isOpen ? day.closingTime : "",
        })),
      });
    });

    // Fetch updated working days
    const workingDays = await prisma.salonWorkingDay.findMany({
      where: { salonId: salon.id },
      orderBy: { day: "asc" },
    });

    revalidatePath("/dashboard/settings");
    return {
      success: true,
      message: "Horaires mis à jour avec succès.",
      data: workingDays,
    };
  } catch (error) {
    console.error("[updateWorkingDays]", error);
    return { success: false, message: "Une erreur est survenue lors de la mise à jour des horaires." };
  }
}
