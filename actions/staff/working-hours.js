"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { isAdminRole } from "@/lib/authorization";
import { workingHoursSchema } from "@/lib/validations/working-hours";
import { addDaysToDateKey, brusselsDateKey } from "@/lib/formations/custom-date-availability";
import { normalizeWeeksOfMonth, weekDayOfDateKey, workingHourForDateKey, worksWeekday } from "@/lib/working-day-overrides";
import { bookedDays, bookedDaysRefusal } from "@/lib/staff-day-unavailability";
import { loadFifthDays } from "@/lib/fifth-days";

const REVALIDATE_PATH = "/dashboard/staff/auto-entrepreneur";

// How far ahead a change of rule is checked against what is already booked.
const CHECK_AHEAD_DAYS = 365;
// How far ahead the modal lists the 5th days of a shared weekday.
const FIFTH_DAYS_AHEAD = 120;

/**
 * Upserts working hours for a given staff member.
 * For each of the 7 days, existing records are updated and missing records are created.
 *
 * A change that takes days away from her — a weekday closed, fewer weeks of
 * the month — is refused while something is already booked on one of those
 * days in the coming year. A weekday she no longer works also drops the 5th
 * days she had been given on it.
 *
 * @param {object} input — { staffId: string, days: Array<{ day: WeekDay, startTime: string, endTime: string, isClosed: boolean, weeksOfMonth?: number[] }> }
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

  const { staffId } = parsed.data;
  const days = parsed.data.days.map((day) => ({
    day: day.day,
    startTime: day.isClosed ? "00:00" : day.startTime,
    endTime: day.isClosed ? "00:00" : day.endTime,
    isClosed: day.isClosed,
    weeksOfMonth: day.isClosed ? [] : normalizeWeeksOfMonth(day.weeksOfMonth),
  }));

  // ── 2. Verify staff exists ───────────────────────────────────────────────
  try {
    const staff = await prisma.staff.findUnique({
      where: { id: staffId },
      select: { id: true, user: { select: { fullName: true } } },
    });

    if (!staff) {
      return {
        success: false,
        message: "Le professionnel est introuvable.",
      };
    }

    // ── 3. Days taken away from her must hold nothing ──────────────────────
    const today = brusselsDateKey(new Date());
    const lastDay = addDaysToDateKey(today, CHECK_AHEAD_DAYS);
    const [oldHours, oldOverrides] = await Promise.all([
      prisma.workingHour.findMany({
        where: { staffId },
        select: { day: true, startTime: true, endTime: true, isClosed: true, weeksOfMonth: true },
      }),
      prisma.workingDayOverride.findMany({
        where: { staffId, dateKey: { gte: today } },
        select: { id: true, dateKey: true, isWorking: true, startTime: true, endTime: true },
      }),
    ]);

    // A 5th day she was given on a weekday she no longer works.
    const droppedOverrides = oldOverrides.filter(
      (o) => o.isWorking && !worksWeekday(days.find((d) => d.day === weekDayOfDateKey(o.dateKey)))
    );
    const droppedIds = new Set(droppedOverrides.map((o) => o.id));
    const newOverrides = oldOverrides.filter((o) => !droppedIds.has(o.id));

    const stopped = [];
    for (let key = today; key <= lastDay; key = addDaysToDateKey(key, 1)) {
      if (workingHourForDateKey(oldHours, oldOverrides, key) && !workingHourForDateKey(days, newOverrides, key)) {
        stopped.push(key);
      }
    }
    const refusal = bookedDaysRefusal(await bookedDays(prisma, staffId, stopped), {
      who: staff.user?.fullName || "Ce membre du personnel",
    });
    if (refusal) return { success: false, message: refusal };

    // ── 4. Upsert each day (findFirst + update or create) ──────────────────
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
                startTime: day.startTime,
                endTime: day.endTime,
                isClosed: day.isClosed,
                weeksOfMonth: day.weeksOfMonth,
              },
            });
          }
          return tx.workingHour.create({
            data: { staffId, ...day },
          });
        })
      );

      if (droppedIds.size > 0) {
        await tx.workingDayOverride.deleteMany({ where: { id: { in: [...droppedIds] } } });
      }
    });

    revalidatePath(REVALIDATE_PATH);
    revalidatePath("/dashboard");

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
 * filling in defaults for any missing days, plus the coming 5th days (who
 * was given each one, if anyone).
 *
 * @param {string} staffId
 * @returns {{ success: boolean, data?: Array<object>, fifthDays?: Array<object>, message?: string }}
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
        weeksOfMonth: true,
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
            weeksOfMonth: record.weeksOfMonth ?? [],
          }
        : {
            day,
            startTime: "09:00",
            endTime: "17:00",
            isClosed: false,
            weeksOfMonth: [],
          };
    });

    const today = brusselsDateKey(new Date());
    const fifthDays = await loadFifthDays(prisma, { from: today, to: addDaysToDateKey(today, FIFTH_DAYS_AHEAD) });

    return {
      success: true,
      data,
      fifthDays: fifthDays.map((d) => ({
        dateKey: d.dateKey,
        day: d.day,
        assignedNames: d.candidates.filter((c) => d.assignedStaffIds.includes(c.staffId)).map((c) => c.name),
        isCandidate: d.candidates.some((c) => c.staffId === staffId),
      })),
    };
  } catch (error) {
    console.error("[getWorkingHours]", error);
    return {
      success: false,
      message: "Impossible de charger les horaires de travail.",
      data: [],
    };
  }
}
