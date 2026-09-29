"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { isAdminRole } from "@/lib/authorization";

const REVALIDATE_PATH = "/dashboard/staff/auto-entrepreneur";

const inputSchema = z.object({
  id: z.string().min(1),
  isActive: z.boolean(),
});

/**
 * « Activer / Désactiver » in the auto-entrepreneur table: flips the active
 * state and nothing else.
 *
 * It used to call updateIndependentStaff with a partial payload, which that
 * full-profile update reads as "these fields are now blank" — it failed
 * validation on the missing yearsOfExperience, and had it passed it would
 * have nulled the VAT number, photo, experience and rythme and removed every
 * service assignment (serviceIds defaults to []).
 *
 * Same side effects as a deactivation through updateIndependentStaff:
 * User.isActive mirrors Staff.isActive (the JWT re-validation checks it) and a
 * deactivation bumps sessionVersion so live sessions end at once.
 *
 * @param {{ id: string, isActive: boolean }} input
 * @returns {{ success: boolean, message: string }}
 */
export async function setIndependentStaffActive(input) {
  const session = await auth();
  if (!session?.user || !isAdminRole(session.user.role)) {
    return { success: false, message: "Permissions insuffisantes" };
  }

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, message: "Requête invalide." };
  }
  const { id, isActive } = parsed.data;

  const existing = await prisma.staff.findUnique({
    where: { id },
    select: { type: true, isDeleted: true, isActive: true, userId: true, user: { select: { fullName: true } } },
  });
  if (!existing || existing.isDeleted) {
    return { success: false, message: "Ce profil auto-entrepreneur est introuvable." };
  }
  if (existing.type !== "INDEPENDENT") {
    return { success: false, message: "Ce profil n'est pas celui d'un auto-entrepreneur." };
  }

  const name = existing.user.fullName;
  const done = isActive ? `${name} a été activé(e).` : `${name} a été désactivé(e).`;
  if (existing.isActive === isActive) {
    return { success: true, message: done };
  }

  try {
    await prisma.$transaction([
      prisma.staff.update({ where: { id }, data: { isActive } }),
      prisma.user.update({
        where: { id: existing.userId },
        data: { isActive, ...(isActive ? {} : { sessionVersion: { increment: 1 } }) },
      }),
    ]);
  } catch (error) {
    console.error("[setIndependentStaffActive]", error);
    return { success: false, message: "Une erreur inattendue s'est produite. Veuillez réessayer." };
  }

  revalidatePath(REVALIDATE_PATH);
  return { success: true, message: done };
}
