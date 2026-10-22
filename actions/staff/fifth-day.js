"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { isAdminRole } from "@/lib/authorization";
import { brusselsDateKey } from "@/lib/formations/custom-date-availability";
import { loadFifthDays } from "@/lib/fifth-days";
import { bookedDays, bookedDaysRefusal } from "@/lib/staff-day-unavailability";
import { weekOfMonthOfDateKey } from "@/lib/working-day-overrides";

/**
 * A month's 5th Saturday (Monday…) is never in anyone's rule: Marie gives it,
 * each time, to the staff members she agreed it with — one, several, or
 * nobody. See lib/fifth-days.js.
 */

const dateKeySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const assignSchema = z.object({
  dateKey: dateKeySchema,
  // [] = nobody works that day.
  staffIds: z.array(z.string().min(1)).max(50),
});

async function requireAdmin() {
  const session = await auth();
  if (!session?.user || !isAdminRole(session.user.role)) return null;
  return session;
}

/** The staff members who could work that 5th day, and who has it. */
export async function getFifthDayOptions(dateKey) {
  if (!(await requireAdmin())) return { success: false, message: "Permissions insuffisantes" };
  if (!dateKeySchema.safeParse(dateKey).success) return { success: false, message: "Date invalide." };

  try {
    const [fifth] = await loadFifthDays(prisma, { dateKeys: [dateKey] });
    if (!fifth) {
      return { success: false, message: "Personne ne travaille ce jour de la semaine." };
    }
    return { success: true, data: fifth };
  } catch (error) {
    console.error("[getFifthDayOptions]", error);
    return { success: false, message: "Impossible de charger ce jour." };
  }
}

/**
 * Gives that 5th day to exactly these staff members (none = nobody). Taking
 * it away from someone is refused while she has something booked that day.
 */
export async function assignFifthDay(input) {
  const session = await requireAdmin();
  if (!session) return { success: false, message: "Permissions insuffisantes" };

  const parsed = assignSchema.safeParse(input);
  if (!parsed.success) return { success: false, message: "Choix invalide." };
  const { dateKey } = parsed.data;
  const staffIds = [...new Set(parsed.data.staffIds)];

  if (weekOfMonthOfDateKey(dateKey) !== 5) return { success: false, message: "Ce jour n'est pas un 5e jour du mois." };
  if (dateKey < brusselsDateKey(new Date())) return { success: false, message: "Ce jour est déjà passé." };

  try {
    const [fifth] = await loadFifthDays(prisma, { dateKeys: [dateKey] });
    if (!fifth) return { success: false, message: "Personne ne travaille ce jour de la semaine." };

    const chosen = fifth.candidates.filter((c) => staffIds.includes(c.staffId));
    if (chosen.length !== staffIds.length) {
      return { success: false, message: "Un membre du personnel choisi ne travaille pas ce jour de la semaine." };
    }

    for (const removed of fifth.candidates.filter((c) => fifth.assignedStaffIds.includes(c.staffId) && !staffIds.includes(c.staffId))) {
      const refusal = bookedDaysRefusal(await bookedDays(prisma, removed.staffId, [dateKey]), { who: removed.name });
      if (refusal) return { success: false, message: refusal };
    }

    await prisma.$transaction(async (tx) => {
      await tx.workingDayOverride.deleteMany({
        where: {
          dateKey,
          isWorking: true,
          staffId: { in: fifth.candidates.map((c) => c.staffId).filter((id) => !staffIds.includes(id)) },
        },
      });
      for (const member of chosen) {
        await tx.workingDayOverride.upsert({
          where: { staffId_dateKey: { staffId: member.staffId, dateKey } },
          update: { isWorking: true, startTime: member.startTime, endTime: member.endTime, createdById: session.user.id },
          create: {
            staffId: member.staffId,
            dateKey,
            isWorking: true,
            startTime: member.startTime,
            endTime: member.endTime,
            createdById: session.user.id,
          },
        });
      }
    });

    revalidatePath("/dashboard");
    revalidatePath("/dashboard/staff/auto-entrepreneur");
    return {
      success: true,
      message:
        chosen.length === 0
          ? "Personne ne travaillera ce jour-là."
          : `${chosen.map((c) => c.name).join(" et ")} ${chosen.length > 1 ? "travailleront" : "travaillera"} ce jour-là.`,
    };
  } catch (error) {
    console.error("[assignFifthDay]", error);
    return { success: false, message: "Une erreur inattendue s'est produite. Veuillez réessayer." };
  }
}
