"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { ROLES } from "@/lib/authorization";

/**
 * Allows a STAFF member to add an existing service to their own profile.
 * Since one service can be assigned to multiple staff members, this action
 * creates (or re-activates) a StaffService record linking the current
 * staff member to the selected service.
 *
 * @param {string} serviceId - The ID of the existing service to assign
 * @returns {{ success: boolean, message: string }}
 */
export async function assignServiceToMe(serviceId) {
  const session = await auth();
  if (!session?.user || session.user.role !== ROLES.STAFF) {
    return { success: false, message: "Permissions insuffisantes" };
  }

  if (!serviceId) {
    return { success: false, message: "Aucun service sélectionné." };
  }

  try {
    // Get the current staff member's record
    const staff = await prisma.staff.findUnique({
      where: { userId: session.user.id, isDeleted: false },
      select: { id: true },
    });

    if (!staff) {
      return { success: false, message: "Profil staff introuvable." };
    }

    // Verify the service exists
    const service = await prisma.service.findUnique({
      where: { id: serviceId },
      select: { id: true, name: true },
    });

    if (!service) {
      return { success: false, message: "Service introuvable." };
    }

    // Check if the staff member is already assigned to this service
    const existing = await prisma.staffService.findFirst({
      where: { staffId: staff.id, serviceId },
    });

    if (existing) {
      if (existing.isActive) {
        return {
          success: false,
          message: `Le service « ${service.name} » est déjà dans votre profil.`,
        };
      }
      // Re-activate a previously deactivated assignment
      await prisma.staffService.update({
        where: { id: existing.id },
        data: { isActive: true },
      });
    } else {
      // Create a new assignment with default price/duration (to be configured later)
      await prisma.staffService.create({
        data: {
          staffId: staff.id,
          serviceId,
          createdById: session.user.id,
          price: 0,
          duration: 0,
          margin: null,
          photo: "",
          isActive: true,
        },
      });
    }

    revalidatePath("/dashboard/services");
    revalidatePath("/dashboard/staff/auto-entrepreneur");

    return {
      success: true,
      message: `Le service « ${service.name} » a été ajouté à votre profil.`,
    };
  } catch (error) {
    console.error("[assignServiceToMe]", error);
    return {
      success: false,
      message: "Une erreur inattendue s'est produite. Veuillez réessayer.",
    };
  }
}