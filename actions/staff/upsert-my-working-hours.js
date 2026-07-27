"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { ROLES } from "@/lib/authorization";
import { staffWorkingHoursSchema } from "@/lib/validations/staff-settings";

const REVALIDATE_PATH = "/dashboard/account-settings";

const ALL_DAYS = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"];

export async function upsertMyWorkingHours(input) {
  const parsed = staffWorkingHoursSchema.safeParse(input);

  if (!parsed.success) {
    const fe = parsed.error.flatten().fieldErrors;
    return {
      success: false,
      message: "Veuillez corriger les erreurs dans les horaires.",
      errors: { days: fe.days?.[0] ?? null },
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

    const { days } = parsed.data;

    await prisma.$transaction(async (tx) => {
      // Delete existing records
      await tx.workingHour.deleteMany({ where: { staffId: staff.id } });

      // Create new records for each day
      for (const day of days) {
        await tx.workingHour.create({
          data: {
            staffId: staff.id,
            day: day.day,
            startTime: day.isClosed ? "00:00" : day.startTime,
            endTime: day.isClosed ? "00:00" : day.endTime,
            isClosed: day.isClosed,
          },
        });
      }
    });

    revalidatePath(REVALIDATE_PATH);

    return { success: true, message: "Horaires de travail enregistrés." };
  } catch (error) {
    console.error("[upsertMyWorkingHours]", error);
    return { success: false, message: "Une erreur est survenue." };
  }
}

export async function getMyWorkingHours() {
  try {
    const session = await auth();

    if (!session?.user || session.user.role !== ROLES.STAFF) {
      return { success: false, data: [], message: "Permissions insuffisantes" };
    }

    const staff = await prisma.staff.findUnique({
      where: { userId: session.user.id },
      select: { id: true },
    });

    if (!staff) {
      return { success: false, data: [], message: "Profil staff introuvable." };
    }

    const existing = await prisma.workingHour.findMany({
      where: { staffId: staff.id },
      select: { id: true, day: true, startTime: true, endTime: true, isClosed: true },
    });

    const map = new Map(existing.map((wh) => [wh.day, wh]));

    const data = ALL_DAYS.map((day) => {
      const record = map.get(day);
      return record
        ? {
            day: record.day,
            startTime: record.startTime,
            endTime: record.endTime,
            isClosed: record.isClosed,
          }
        : {
            day,
            startTime: "09:00",
            endTime: "17:00",
            isClosed: false,
          };
    });

    return { success: true, data };
  } catch (error) {
    console.error("[getMyWorkingHours]", error);
    return { success: false, data: [], message: "Impossible de charger vos horaires." };
  }
}
