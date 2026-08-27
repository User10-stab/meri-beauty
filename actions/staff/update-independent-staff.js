"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { isAdminRole } from "@/lib/authorization";
import { updateIndependentStaffSchema } from "@/lib/validations/independent-staff";

const REVALIDATE_PATH = "/dashboard/staff/auto-entrepreneur";

/**
 * Full update of an independent staff member and its related records.
 *
 * Editable fields:
 *   User  → fullName, phone
 *   Staff → photo, bio, languages, yearsOfExperience, hireDate, isActive
 *   Services → replaces the full StaffService assignment set
 *   Contract → upserts the active FIXED_RENT contract
 *
 * All mutations run inside a single Prisma transaction.
 *
 * @param {object} input
 * @returns {{ success: boolean, message: string, errors?: object }}
 */
export async function updateIndependentStaff(input) {
  const session = await auth();
  if (!session?.user || !isAdminRole(session.user.role)) {
    return { success: false, message: "Permissions insuffisantes" };
  }

  // ── 1. Validate ──────────────────────────────────────────────────────────
  const parsed = updateIndependentStaffSchema.safeParse(input);

  if (!parsed.success) {
    const fe = parsed.error.flatten().fieldErrors;
    return {
      success: false,
      message: "Veuillez corriger les erreurs dans le formulaire.",
      errors: {
        fullName:          fe.fullName?.[0]          ?? null,
        phone:             fe.phone?.[0]             ?? null,
        photo:             fe.photo?.[0]             ?? null,
        bio:               fe.bio?.[0]               ?? null,
        languages:         fe.languages?.[0]         ?? null,
        yearsOfExperience: fe.yearsOfExperience?.[0] ?? null,
        hireDate:          fe.hireDate?.[0]          ?? null,
        vatNumber:         fe.vatNumber?.[0]         ?? null,
        serviceIds:        fe.serviceIds?.[0]        ?? null,
        dashboardPermissions: fe.dashboardPermissions?.[0] ?? null,
        contract:          fe["contract"]?.[0]       ?? null,
      },
    };
  }

  const {
    id,
    fullName,
    phone,
    photo,
    bio,
    languages,
    yearsOfExperience,
    hireDate,
    vatNumber,
    isActive,
    serviceIds,
    dashboardPermissions,
    contract,
  } = parsed.data;

  // ── 2. Load existing staff — guard type + existence ──────────────────────
  const existing = await prisma.staff.findUnique({
    where: { id },
    select: {
      id:        true,
      type:      true,
      isDeleted: true,
      isActive:  true,
      userId:    true,
      user:      { select: { id: true, fullName: true, email: true } },
    },
  });

  if (!existing || existing.isDeleted) {
    return { success: false, message: "Ce profil auto-entrepreneur est introuvable." };
  }
  if (existing.type !== "INDEPENDENT") {
    return { success: false, message: "Ce profil n'est pas celui d'un auto-entrepreneur." };
  }

  // Capture the current active state so we can detect a deactivation inside
  // the transaction without an extra round-trip after the fact.
  const wasActive = existing.isActive;

  // ── 3. Validate service IDs exist (before entering transaction) ──────────
  const newServiceIds = serviceIds ?? [];
  if (newServiceIds.length > 0) {
    const found = await prisma.service.findMany({
      where: { id: { in: newServiceIds } },
      select: { id: true },
    });
    if (found.length !== newServiceIds.length) {
      return {
        success: false,
        message: "Un ou plusieurs services sélectionnés sont introuvables.",
        errors: { serviceIds: "Services introuvables." },
      };
    }
  }

  // ── 4. Transaction ───────────────────────────────────────────────────────
  try {
    await prisma.$transaction(async (tx) => {

      // 4a. Update User (only fields that were provided)
      const userUpdate = {};
      if (fullName !== undefined) userUpdate.fullName = fullName;
      if (phone    !== undefined) userUpdate.phone    = phone;

      // Keep User.isActive in sync with Staff.isActive so the auth JWT
      // re-validation (which checks User.isActive) correctly blocks login.
      // On deactivation, bump sessionVersion as well — this immediately
      // invalidates any live JWT on the staff member's next authenticated
      // request instead of waiting for the 5-minute revalidation window.
      if (isActive !== undefined && isActive !== wasActive) {
        userUpdate.isActive = isActive;
        if (!isActive) {
          userUpdate.sessionVersion = { increment: 1 };
        }
      }

      if (Object.keys(userUpdate).length > 0) {
        await tx.user.update({
          where: { id: existing.userId },
          data:  userUpdate,
        });
      }

      // 4b. Update Staff
      await tx.staff.update({
        where: { id },
        data: {
          photo:             photo             ?? null,
          bio:               bio               ?? null,
          languages:         languages         ?? [],
          yearsOfExperience: yearsOfExperience ?? null,
          vatNumber:         vatNumber         ?? null,
          isActive,
          hireDate: hireDate ? new Date(hireDate) : null,
          ...(dashboardPermissions !== undefined ? { dashboardPermissions } : {}),
        },
      });

      // 4c. Replace service assignments
      // Delete all current StaffService rows, then re-create the new set.
      // We skip records that have linked appointments (isActive = false instead).
      if (serviceIds !== undefined) {
        const current = await tx.staffService.findMany({
          where: { staffId: id },
          select: {
            id:       true,
            serviceId: true,
            _count:   { select: { appointments: true } },
          },
        });

        const toKeep   = new Set(newServiceIds);
        const toRemove = current.filter((ss) => !toKeep.has(ss.serviceId));
        const toAdd    = newServiceIds.filter(
          (sid) => !current.some((ss) => ss.serviceId === sid)
        );

        // Soft-deactivate rows that have appointments, hard-delete the rest
        for (const ss of toRemove) {
          if (ss._count.appointments > 0) {
            await tx.staffService.update({
              where: { id: ss.id },
              data:  { isActive: false },
            });
          } else {
            await tx.staffService.delete({ where: { id: ss.id } });
          }
        }

        // Re-activate rows that were previously soft-deleted and are now re-added
        for (const sid of toAdd) {
          const softDeleted = await tx.staffService.findFirst({
            where: { staffId: id, serviceId: sid },
          });
          if (softDeleted) {
            await tx.staffService.update({
              where: { id: softDeleted.id },
              data:  { isActive: true },
            });
          } else {
            await tx.staffService.create({
              data: {
                staffId:     id,
                serviceId:   sid,
                createdById: existing.userId,
                price:       0,
                duration:    0,
                photo:       "",
                isActive:    true,
              },
            });
          }
        }
      }

      // 4d. Upsert contract (always FIXED_RENT)
      if (contract !== undefined) {
        if (contract === null) {
          // Remove the active contract if it has no linked appointments
          const active = await tx.contract.findFirst({
            where:  { staffId: id, status: "ACTIVE" },
            select: { id: true },
          });
          if (active) {
            await tx.contract.update({
              where: { id: active.id },
              data:  { status: "TERMINATED" },
            });
          }
        } else {
          // Terminate the current active contract (if different) and create new one
          await tx.contract.updateMany({
            where: { staffId: id, status: "ACTIVE" },
            data:  { status: "TERMINATED" },
          });
          await tx.contract.create({
            data: {
              staffId:   id,
              type:      "FIXED_RENT",
              fixedRent: contract.fixedRent,
              startDate: new Date(contract.startDate),
              endDate:   contract.endDate ? new Date(contract.endDate) : null,
              status:    "ACTIVE",
              notes:     contract.notes ?? null,
            },
          });
        }
      }
    });

    revalidatePath(REVALIDATE_PATH);

    return {
      success: true,
      message: `Le profil de ${existing.user.fullName} a été mis à jour avec succès.`,
    };
  } catch (error) {
    if (error.code === "P2002") {
      const fields = error.meta?.target ?? [];
      if (fields.includes("phone")) {
        return {
          success: false,
          message: "Ce numéro de téléphone est déjà utilisé.",
          errors: { phone: "Ce numéro est déjà utilisé." },
        };
      }
      if (fields.includes("email")) {
        return {
          success: false,
          message: "Cette adresse e-mail est déjà utilisée.",
          errors: { email: "Cet e-mail est déjà utilisé." },
        };
      }
    }

    console.error("[updateIndependentStaff]", error);
    return {
      success: false,
      message: "Une erreur inattendue s'est produite. Veuillez réessayer.",
    };
  }
}
