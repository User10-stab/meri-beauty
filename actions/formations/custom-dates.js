"use server";

import { prisma } from "@/lib/prisma";
import { getCustomDateMonth, getCustomDateSlots } from "@/lib/formations/custom-date-availability";

/**
 * Read-only availability for a private formation's « date libre » picker.
 * Both are public endpoints (the booking page is open to guests) and expose
 * only which days and start times are free — never what occupies the others.
 */
async function loadBookablePrivateFormation(formationId) {
  if (!formationId || typeof formationId !== "string") return null;
  return prisma.formation.findFirst({
    where: { id: formationId, status: "PUBLISHED", type: "PRIVATE" },
    select: { id: true, type: true, duration: true, animatorId: true, createdById: true },
  });
}

/** Which days of "YYYY-MM" can start a one-day / a two-day booking. */
export async function getFormationCustomDateMonth(formationId, monthKey) {
  try {
    const formation = await loadBookablePrivateFormation(formationId);
    if (!formation) return { success: false, message: "Formation introuvable." };
    const data = await getCustomDateMonth(prisma, { formation, monthKey });
    return { success: true, data };
  } catch (error) {
    console.error("[getFormationCustomDateMonth]", error);
    return { success: false, message: "Impossible de charger les disponibilités." };
  }
}

/** The free start times of one "YYYY-MM-DD", for one day and for two. */
export async function getFormationCustomDateSlots(formationId, dateKey) {
  try {
    const formation = await loadBookablePrivateFormation(formationId);
    if (!formation) return { success: false, message: "Formation introuvable." };
    const data = await getCustomDateSlots(prisma, { formation, dateKey });
    return { success: true, data };
  } catch (error) {
    console.error("[getFormationCustomDateSlots]", error);
    return { success: false, message: "Impossible de charger les horaires." };
  }
}
