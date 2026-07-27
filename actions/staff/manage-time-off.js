"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { ROLES } from "@/lib/authorization";
import { staffTimeOffSchema } from "@/lib/validations/staff-settings";

const REVALIDATE_PATH = "/dashboard/account-settings";

export async function createStaffTimeOff(input) {
  const parsed = staffTimeOffSchema.safeParse(input);

  if (!parsed.success) {
    const fe = parsed.error.flatten().fieldErrors;
    return {
      success: false,
      message: "Veuillez corriger les erreurs dans les indisponibilités.",
      errors: {
        startDate: fe.startDate?.[0] ?? null,
        endDate: fe.endDate?.[0] ?? null,
        reason: fe.reason?.[0] ?? null,
      },
    };
  }

  try {
    const session = await auth();

    if (!session?.user || session.user.role !== ROLES.STAFF) {
      return { success: false, message: "Permissions insuffisantes" };
    }

    const staff = await prisma.staff.findUnique({
      where: { userId: session.user.id },
      select: { id: true },
    });

    if (!staff) {
      return { success: false, message: "Profil staff introuvable." };
    }

    const { startDate, endDate, reason } = parsed.data;

    const created = await prisma.timeOff.create({
      data: {
        staffId: staff.id,
        startDate: new Date(startDate),
        endDate: new Date(endDate),
        reason: reason || null,
      },
      select: {
        id: true,
        startDate: true,
        endDate: true,
        reason: true,
      },
    });

    revalidatePath(REVALIDATE_PATH);

    return {
      success: true,
      message: "Période d’indisponibilité ajoutée.",
      data: {
        id: created.id,
        startDate: created.startDate.toISOString(),
        endDate: created.endDate.toISOString(),
        reason: created.reason,
      },
    };
  } catch (error) {
    console.error("[createStaffTimeOff]", error);
    return { success: false, message: "Une erreur est survenue." };
  }
}
