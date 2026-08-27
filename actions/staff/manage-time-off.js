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

/**
 * Combine a date string ("YYYY-MM-DD") and time string ("HH:MM")
 * into a full ISO datetime string.  For full-day absences the time
 * component is irrelevant, so we default to 00:00 for start and
 * 23:59:59 for end.
 */
function buildDateTime(dateStr, timeStr, isEnd = false) {
  if (timeStr) {
    return new Date(`${dateStr}T${timeStr}:00`);
  }
  return isEnd
    ? new Date(`${dateStr}T23:59:59`)
    : new Date(`${dateStr}T00:00:00`);
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
        startTime: fe.startTime?.[0] ?? null,
        endTime: fe.endTime?.[0] ?? null,
        isFullDay: fe.isFullDay?.[0] ?? null,
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

    const { startDate, endDate, isFullDay, startTime, endTime, reason } = parsed.data;

    const created = await prisma.timeOff.create({
      data: {
        staffId: staff.id,
        startDate: buildDateTime(startDate.split("T")[0], isFullDay ? null : startTime, false),
        endDate: buildDateTime(endDate.split("T")[0], isFullDay ? null : endTime, true),
        isFullDay: isFullDay !== false,
        reason: reason || null,
      },
      select: {
        id: true,
        startDate: true,
        endDate: true,
        isFullDay: true,
        reason: true,
      },
    });

    revalidatePath(REVALIDATE_PATH);

    return {
      success: true,
      message: "Période d'indisponibilité ajoutée.",
      data: {
        id: created.id,
        startDate: created.startDate.toISOString(),
        endDate: created.endDate.toISOString(),
        isFullDay: created.isFullDay,
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
        startTime: fe.startTime?.[0] ?? null,
        endTime: fe.endTime?.[0] ?? null,
        isFullDay: fe.isFullDay?.[0] ?? null,
        reason: fe.reason?.[0] ?? null,
      },
    };
  }

  try {
    const staffId = await getOwnStaffId();

    if (!staffId) {
      return { success: false, message: "Permissions insuffisantes" };
    }

    const { startDate, endDate, isFullDay, startTime, endTime, reason } = parsed.data;

    const { count } = await prisma.timeOff.updateMany({
      where: { id, staffId },
      data: {
        startDate: buildDateTime(startDate.split("T")[0], isFullDay ? null : startTime, false),
        endDate: buildDateTime(endDate.split("T")[0], isFullDay ? null : endTime, true),
        isFullDay: isFullDay !== false,
        reason: reason || null,
      },
    });

    if (count === 0) {
      return { success: false, message: "Indisponibilité introuvable." };
    }

    revalidatePath(REVALIDATE_PATH);

    return {
      success: true,
      message: "Période d'indisponibilité modifiée.",
      data: {
        id,
        startDate: buildDateTime(startDate.split("T")[0], isFullDay ? null : startTime, false).toISOString(),
        endDate: buildDateTime(endDate.split("T")[0], isFullDay ? null : endTime, true).toISOString(),
        isFullDay: isFullDay !== false,
        reason: reason || null,
      },
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
