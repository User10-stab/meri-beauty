"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { ROLES } from "@/lib/authorization";
import { updateReservationSettingsSchema } from "@/lib/validations/staff-settings";

const REVALIDATE_PATH = "/dashboard/account-settings";

export async function updateReservationSettings(input) {
  const parsed = updateReservationSettingsSchema.safeParse(input);

  if (!parsed.success) {
    const fe = parsed.error.flatten().fieldErrors;
    return {
      success: false,
      message: "Veuillez corriger les erreurs.",
      errors: {
        confirmationMode: fe.confirmationMode?.[0] ?? null,
        depositEnabled: fe.depositEnabled?.[0] ?? null,
        depositPercentage: fe.depositPercentage?.[0] ?? null,
      },
    };
  }

  try {
    const session = await auth();

    if (!session?.user || session.user.role !== ROLES.STAFF) {
      return { success: false, message: "Permissions insuffisantes" };
    }

    const { confirmationMode, depositEnabled, depositPercentage } = parsed.data;

    await prisma.staff.update({
      where: { userId: session.user.id },
      data: {
        reservationConfirmationMode: confirmationMode,
        depositEnabled,
        depositPercentage: depositEnabled && depositPercentage != null ? depositPercentage : 0,
      },
    });

    revalidatePath(REVALIDATE_PATH);

    return { success: true, message: "Paramètres de réservation mis à jour." };
  } catch (error) {
    console.error("[updateReservationSettings]", error);
    return { success: false, message: "Une erreur est survenue." };
  }
}
