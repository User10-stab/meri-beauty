"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { isAdminRole } from "@/lib/authorization";
import { softDeleteStaffSchema } from "@/lib/validations/independent-staff";

const REVALIDATE_PATH = "/dashboard/staff/auto-entrepreneur";

/**
 * Soft-deletes an independent staff member.
 *
 * Soft delete means:
 *   • Staff.isActive  = false
 *   • User.isActive   = false
 *   • All active StaffService rows are deactivated (isActive = false)
 *   • The active Contract is terminated (status = TERMINATED)
 *   • No records are physically removed — data is preserved for audit / history
 *
 * Hard delete is intentionally NOT performed here. If the staff member has
 * appointments or payments, those records must be preserved for legal / financial
 * compliance. The admin can always reactivate the profile if needed.
 *
 * @param {{ id: string, reason?: string }} input
 * @returns {{ success: boolean, message: string }}
 */
export async function deleteIndependentStaff(input) {
  const session = await auth();
  if (!session?.user || !isAdminRole(session.user.role)) {
    return { success: false, message: "Permissions insuffisantes" };
  }

  // ── 1. Validate input ────────────────────────────────────────────────────
  const parsed = softDeleteStaffSchema.safeParse(input);

  if (!parsed.success) {
    return {
      success: false,
      message: parsed.error.flatten().fieldErrors.id?.[0]
               ?? "Identifiant du profil manquant ou invalide.",
    };
  }

  const { id } = parsed.data;

  // ── 2. Load staff + guard ────────────────────────────────────────────────
  let existing;
  try {
    existing = await prisma.staff.findUnique({
      where: { id },
      select: {
        id:        true,
        type:      true,
        isActive:  true,
        isDeleted: true,
        userId:    true,
        user:      { select: { fullName: true, isActive: true, isDeleted: true } },
      },
    });
  } catch (error) {
    console.error("[deleteIndependentStaff] findUnique", error);
    return {
      success: false,
      message: "Une erreur inattendue s'est produite. Veuillez réessayer.",
    };
  }

  if (!existing || existing.isDeleted) {
    return {
      success: false,
      message: "Ce profil auto-entrepreneur est introuvable.",
    };
  }

  if (existing.type !== "INDEPENDENT") {
    return {
      success: false,
      message: "Ce profil n'est pas celui d'un auto-entrepreneur.",
    };
  }

  if (!existing.isActive && !existing.user.isActive) {
    return {
      success: false,
      message: "Ce profil est déjà désactivé.",
    };
  }

  const fullName = existing.user.fullName;

  // ── 3. Soft-delete transaction ───────────────────────────────────────────
  try {
    const now = new Date();

    await prisma.$transaction([
      // Soft-delete the User account — blocks login immediately.
      // sessionVersion bump invalidates any live JWT on the staff member's
      // very next authenticated request rather than waiting up to 5 minutes
      // for the periodic revalidation window to expire.
      prisma.user.update({
        where: { id: existing.userId },
        data:  { isActive: false, isDeleted: true, deletedAt: now, sessionVersion: { increment: 1 } },
      }),

      // Soft-delete the Staff profile
      prisma.staff.update({
        where: { id },
        data:  { isActive: false, isDeleted: true, deletedAt: now },
      }),

      // Deactivate all active StaffService assignments
      prisma.staffService.updateMany({
        where: { staffId: id, isActive: true },
        data:  { isActive: false },
      }),

      // Terminate the active contract (if any)
      prisma.contract.updateMany({
        where: { staffId: id, status: "ACTIVE" },
        data:  { status: "TERMINATED" },
      }),
    ]);

    revalidatePath(REVALIDATE_PATH);

    return {
      success: true,
      message: `Le profil de ${fullName} a été désactivé. Toutes les données sont conservées.`,
    };
  } catch (error) {
    console.error("[deleteIndependentStaff] transaction", error);
    return {
      success: false,
      message: "Une erreur inattendue s'est produite. Veuillez réessayer.",
    };
  }
}

/**
 * Permanently deletes an independent staff member and ALL related records.
 * Only callable when the staff has no appointments (future or past).
 *
 * This is a separate, explicitly-named function to make destructive intent clear.
 * The REST API hard-delete endpoint calls this.
 *
 * @param {{ id: string }} input
 * @returns {{ success: boolean, message: string }}
 */
export async function hardDeleteIndependentStaff({ id }) {
  const session = await auth();
  if (!session?.user || !isAdminRole(session.user.role)) {
    return { success: false, message: "Permissions insuffisantes" };
  }

  if (!id || typeof id !== "string") {
    return {
      success: false,
      message: "Identifiant du profil manquant ou invalide.",
    };
  }

  const existing = await prisma.staff.findUnique({
    where: { id },
    select: {
      id:     true,
      type:   true,
      userId: true,
      user:   { select: { fullName: true } },
      staffServices: {
        select: { _count: { select: { appointments: true } } },
      },
    },
  }).catch(() => null);

  if (!existing) {
    return { success: false, message: "Ce profil auto-entrepreneur est introuvable." };
  }
  if (existing.type !== "INDEPENDENT") {
    return { success: false, message: "Ce profil n'est pas celui d'un auto-entrepreneur." };
  }

  // Refuse hard-delete if ANY appointment exists
  const hasAppointments = existing.staffServices.some(
    (ss) => ss._count.appointments > 0
  );
  if (hasAppointments) {
    return {
      success: false,
      message:
        "Impossible de supprimer définitivement ce profil : des rendez-vous y sont associés. Utilisez la désactivation à la place.",
    };
  }

  const fullName = existing.user.fullName;

  try {
    await prisma.$transaction(async (tx) => {
      // Remove in FK-safe order
      await tx.contract.deleteMany({     where: { staffId: id } });
      await tx.workingHour.deleteMany({  where: { staffId: id } });
      await tx.timeOff.deleteMany({      where: { staffId: id } });
      await tx.staffService.deleteMany({ where: { staffId: id } });
      await tx.staff.delete({            where: { id } });
      await tx.user.delete({             where: { id: existing.userId } });
    });

    revalidatePath(REVALIDATE_PATH);

    return {
      success: true,
      message: `Le profil de ${fullName} a été supprimé définitivement.`,
    };
  } catch (error) {
    console.error("[hardDeleteIndependentStaff]", error);
    return {
      success: false,
      message: "Une erreur inattendue s'est produite. Veuillez réessayer.",
    };
  }
}
