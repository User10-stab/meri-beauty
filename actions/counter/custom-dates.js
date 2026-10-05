"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { STAFF_PERMISSIONS, canUseSalonTill, hasDashboardPermission } from "@/lib/authorization";
import { COUNTER_SELLABLE_CATALOGUE_STATUSES } from "@/lib/counter/catalogue-availability";
import { getCustomDateMonth, getCustomDateSlots } from "@/lib/formations/custom-date-availability";

/**
 * The counter's twin of actions/formations/custom-dates.js: the same
 * « date libre » calendar, for a private formation the counter may sell —
 * brouillon and archivé included, like every counter sale
 * (COUNTER_SELLABLE_CATALOGUE_STATUSES), so staff only.
 */
async function loadCounterPrivateFormation(formationId) {
  const session = await auth();
  if (!session?.user) return null;
  const [canUseTill, canReserve] = await Promise.all([
    canUseSalonTill(session.user),
    hasDashboardPermission(session.user, STAFF_PERMISSIONS.FORMATION_RESERVATIONS),
  ]);
  if (!canUseTill || !canReserve || !formationId || typeof formationId !== "string") return null;
  return prisma.formation.findFirst({
    where: { id: formationId, status: { in: COUNTER_SELLABLE_CATALOGUE_STATUSES }, type: "PRIVATE" },
    select: { id: true, type: true, duration: true, animatorId: true, createdById: true },
  });
}

export async function getCounterCustomDateMonth(formationId, monthKey) {
  try {
    const formation = await loadCounterPrivateFormation(formationId);
    if (!formation) return { success: false, message: "Formation introuvable." };
    return { success: true, data: await getCustomDateMonth(prisma, { formation, monthKey }) };
  } catch (error) {
    console.error("[getCounterCustomDateMonth]", error);
    return { success: false, message: "Impossible de charger les disponibilités." };
  }
}

export async function getCounterCustomDateSlots(formationId, dateKey) {
  try {
    const formation = await loadCounterPrivateFormation(formationId);
    if (!formation) return { success: false, message: "Formation introuvable." };
    return { success: true, data: await getCustomDateSlots(prisma, { formation, dateKey }) };
  } catch (error) {
    console.error("[getCounterCustomDateSlots]", error);
    return { success: false, message: "Impossible de charger les horaires." };
  }
}
