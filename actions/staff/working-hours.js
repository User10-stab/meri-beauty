"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { isAdminRole } from "@/lib/authorization";
import { workingHoursSchema } from "@/lib/validations/working-hours";

const REVALIDATE_PATH = "/dashboard/staff/auto-entrepreneur";

/**
 * Upserts working hours for a given staff member.
 * For each of the 7 days, existing records are updated and missing records are created.
 *
 * @param {object} input — { staffId: string, days: Array<{ day: WeekDay, startTime: string, endTime: string, isClosed: boolean }> }
 * @returns {{ success: boolean, message: string, errors?: object }}
 */
export async function upsertWorkingHours(input) {
  const session = await auth();
  if (!session?.user || !isAdminRole(session.user.role)) {
    return { success: false, message: "Permissions insuffisantes" };
  }

  // ── 1. Validate ──────────────────────────────────────────────────────────
  const parsed = workingHoursSchema.safeParse(input);

  if (!parsed.success) {
    const fe = parsed.error.flatten().fieldErrors;
    return {
      success: false,
      message: "Veuillez corriger les erreurs dans le formulaire.",
      errors: {
        staffId: fe.staffId?.[0] ?? null,
        days: fe.days?.[0] ?? null,
      },
    };
  }

  const { staffId, days } = parsed.data;

  // ── 2. Verify staff exists ───────────────────────────────────────────────
  try {
    const staff = await prisma.staff.findUnique({
      where: { id: staffId },
      select: { id: true },
    });

    if (!staff) {
      return {
        success: false,
        message: "Le professionnel est introuvable.",
      };
    }

    // ── 3. Upsert each day (findFirst + update or create) ──────────────────
    await prisma.$transaction(async (tx) => {
      await Promise.all(
        days.map(async (day) => {
          const existing = await tx.workingHour.findFirst({
            where: { staffId, day: day.day },
          });

          if (existing) {
            return tx.workingHour.update({
              where: { id: existing.id },
              data: {
                startTime: day.isClosed ? "00:00" : day.startTime,
                endTime: day.isClosed ? "00:00" : day.endTime,
                isClosed: day.isClosed,
              },
            });
          }
          return tx.workingHour.create({
            data: {
              staffId,
              day: day.day,
              startTime: day.isClosed ? "00:00" : day.startTime,
              endTime: day.isClosed ? "00:00" : day.endTime,
              isClosed: day.isClosed,
            },
          });
        })
      );
    });

    revalidatePath(REVALIDATE_PATH);

    return {
      success: true,
      message: "Les horaires de travail ont été enregistrés avec succès.",
    };
  } catch (error) {
    console.error("[upsertWorkingHours]", error);
    return {
      success: false,
      message: "Une erreur inattendue s'est produite. Veuillez réessayer.",
    };
  }
}

/**
 * Fetches working hours for a staff member. Returns 7 days (mon–sun),
 * filling in defaults for any missing days.
 *
 * @param {string} staffId
 * @returns {{ success: boolean, data?: Array<object>, message?: string }}
 */
export async function getWorkingHours(staffId) {
  const session = await auth();
  if (!session?.user || !isAdminRole(session.user.role)) {
    return { success: false, data: [], message: "Permissions insuffisantes" };
  }

  try {
    const allDays = [
      "MONDAY",
      "TUESDAY",
      "WEDNESDAY",
      "THURSDAY",
      "FRIDAY",
      "SATURDAY",
      "SUNDAY",
    ];

    const existing = await prisma.workingHour.findMany({
      where: { staffId },
      select: {
        id: true,
        day: true,
        startTime: true,
        endTime: true,
        isClosed: true,
      },
    });

    const map = new Map(existing.map((wh) => [wh.day, wh]));

    const data = allDays.map((day) => {
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
    console.error("[getWorkingHours]", error);
    return {
      success: false,
      message: "Impossible de charger les horaires de travail.",
      data: [],
    };
  }
}