"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { ROLES } from "@/lib/authorization";
import { staffTimeOffSchema } from "@/lib/validations/staff-settings";

const REVALIDATE_PATH = "/dashboard/account-settings";

async function getOwnStaffId() {
  const session = await auth();

  if (!session?.user || session.user.role !== ROLES.STAFF) {
    return null;
  }

  const staff = await prisma.staff.findUnique({
    where: { userId: session.user.id },
    select: { id: true },
  });

  return staff?.id ?? null;
}

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

export async function updateStaffTimeOff(id, input) {
  if (!id) {
    return { success: false, message: "Indisponibilité introuvable." };
  }

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
    const staffId = await getOwnStaffId();

    if (!staffId) {
      return { success: false, message: "Permissions insuffisantes" };
    }

    const { startDate, endDate, reason } = parsed.data;

    // Scope the update to staffId as well as id — a staff member can only
    // ever touch their own time-off rows, never another staff member's by
    // guessing/reusing an id.
    const { count } = await prisma.timeOff.updateMany({
      where: { id, staffId },
      data: {
        startDate: new Date(startDate),
        endDate: new Date(endDate),
        reason: reason || null,
      },
    });

    if (count === 0) {
      return { success: false, message: "Indisponibilité introuvable." };
    }

    revalidatePath(REVALIDATE_PATH);

    return {
      success: true,
      message: "Période d’indisponibilité modifiée.",
      data: { id, startDate, endDate, reason: reason || null },
    };
  } catch (error) {
    console.error("[updateStaffTimeOff]", error);
    return { success: false, message: "Une erreur est survenue." };
  }
}

export async function deleteStaffTimeOff(id) {
  if (!id) {
    return { success: false, message: "Indisponibilité introuvable." };
  }

  try {
    const staffId = await getOwnStaffId();

    if (!staffId) {
      return { success: false, message: "Permissions insuffisantes" };
    }

    const { count } = await prisma.timeOff.deleteMany({
      where: { id, staffId },
    });

    if (count === 0) {
      return { success: false, message: "Indisponibilité introuvable." };
    }

    revalidatePath(REVALIDATE_PATH);

    return { success: true, message: "Indisponibilité supprimée." };
  } catch (error) {
    console.error("[deleteStaffTimeOff]", error);
    return { success: false, message: "Une erreur est survenue." };
  }
}
