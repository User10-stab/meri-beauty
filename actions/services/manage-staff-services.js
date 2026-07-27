"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { isAdminRole } from "@/lib/authorization";
import {
  staffServiceAssignmentSchema,
  staffServiceUpdateSchema,
} from "@/lib/validations/staff-service";

const REVALIDATE_PATH = "/dashboard/services";

function serializeAssignment(assignment) {
  return {
    id: assignment.id,
    staffId: assignment.staffId,
    serviceId: assignment.serviceId,
    staffName: assignment.staff?.user?.fullName ?? "—",
    staffEmail: assignment.staff?.user?.email ?? null,
    price: assignment.price !== undefined && assignment.price !== null ? Number(assignment.price) : 0,
    duration: assignment.duration,
    margin: assignment.margin !== undefined && assignment.margin !== null ? Number(assignment.margin) : null,
    photo: assignment.photo ?? "",
    isActive: assignment.isActive,
  };
}

export async function getServiceStaffAssignments(serviceId) {
  const session = await auth();
  if (!session?.user || !isAdminRole(session.user.role)) {
    return { success: false, message: "Permissions insuffisantes", data: null };
  }

  if (!serviceId) {
    return { success: false, message: "Aucun service sélectionné.", data: null };
  }

  try {
    const [service, staffOptions, assignments] = await Promise.all([
      prisma.service.findUnique({
        where: { id: serviceId },
        select: {
          id: true,
          name: true,
          description: true,
          category: { select: { id: true, name: true } },
        },
      }),
      prisma.staff.findMany({
        where: { isDeleted: false, user: { isDeleted: false } },
        orderBy: [{ user: { fullName: "asc" } }],
        select: {
          id: true,
          user: { select: { id: true, fullName: true, email: true } },
        },
      }),
      prisma.staffService.findMany({
        where: { serviceId },
        orderBy: [{ staff: { user: { fullName: "asc" } } }],
        include: {
          staff: {
            select: {
              id: true,
              user: { select: { id: true, fullName: true, email: true } },
            },
          },
        },
      }),
    ]);

    if (!service) {
      return { success: false, message: "Le service est introuvable.", data: null };
    }

    return {
      success: true,
      data: {
        service: {
          id: service.id,
          name: service.name,
          description: service.description,
          category: service.category,
        },
        staffOptions: staffOptions.map((staff) => ({
          id: staff.id,
          label: `${staff.user.fullName} (${staff.user.email})`,
        })),
        assignments: assignments.map(serializeAssignment),
      },
    };
  } catch (error) {
    console.error("[getServiceStaffAssignments]", error);
    return {
      success: false,
      message: "Impossible de charger les assignations de ce service.",
      data: null,
    };
  }
}

export async function assignStaffService(input) {
  const session = await auth();
  if (!session?.user || !isAdminRole(session.user.role)) {
    return { success: false, message: "Permissions insuffisantes" };
  }
  if (!session?.user?.id) {
    return { success: false, message: "Vous devez être connecté pour réaliser cette action." };
  }

  const parsed = staffServiceAssignmentSchema.safeParse(input);

  if (!parsed.success) {
    const errors = parsed.error.flatten().fieldErrors;
    return {
      success: false,
      message: "Veuillez corriger les erreurs du formulaire.",
      errors: {
        staffId: errors.staffId?.[0] ?? null,
        serviceId: errors.serviceId?.[0] ?? null,
        price: errors.price?.[0] ?? null,
        duration: errors.duration?.[0] ?? null,
        margin: errors.margin?.[0] ?? null,
        photo: errors.photo?.[0] ?? null,
      },
    };
  }

  const { staffId, serviceId, price, duration, margin, photo, isActive } = parsed.data;

  try {
    const [staff, service] = await Promise.all([
      prisma.staff.findUnique({ where: { id: staffId }, select: { id: true } }),
      prisma.service.findUnique({ where: { id: serviceId }, select: { id: true } }),
    ]);

    if (!staff || !service) {
      return {
        success: false,
        message: "Le professionnel ou le service sélectionné est introuvable.",
        errors: {
          staffId: !staff ? "Professionnel introuvable." : null,
          serviceId: !service ? "Service introuvable." : null,
        },
      };
    }

    const record = await prisma.staffService.create({
      data: {
        staffId,
        serviceId,
        createdById: session.user.id,
        price,
        duration,
        margin: margin ?? null,
        photo: photo ?? "",
        isActive: isActive ?? true,
      },
      include: {
        staff: { select: { user: { select: { fullName: true, email: true } } } },
      },
    });

    revalidatePath(REVALIDATE_PATH);

    return {
      success: true,
      message: "L’assignation a bien été créée.",
      assignment: serializeAssignment({
        ...record,
        staff: record.staff,
      }),
    };
  } catch (error) {
    if (error?.code === "P2002") {
      return {
        success: false,
        message: "Ce professionnel propose déjà ce service.",
        errors: { staffId: "Ce professionnel propose déjà ce service." },
      };
    }

    console.error("[assignStaffService]", error);
    return {
      success: false,
      message: "Une erreur inattendue s’est produite. Veuillez réessayer.",
    };
  }
}

export async function updateStaffService(input) {
  const session = await auth();
  if (!session?.user || !isAdminRole(session.user.role)) {
    return { success: false, message: "Permissions insuffisantes" };
  }

  const parsed = staffServiceUpdateSchema.safeParse(input);

  if (!parsed.success) {
    const errors = parsed.error.flatten().fieldErrors;
    return {
      success: false,
      message: "Veuillez corriger les erreurs du formulaire.",
      errors: {
        price: errors.price?.[0] ?? null,
        duration: errors.duration?.[0] ?? null,
        margin: errors.margin?.[0] ?? null,
        photo: errors.photo?.[0] ?? null,
      },
    };
  }

  const { id, price, duration, margin, photo, isActive } = parsed.data;

  try {
    const updated = await prisma.staffService.update({
      where: { id },
      data: {
        ...(price !== undefined ? { price } : {}),
        ...(duration !== undefined ? { duration } : {}),
        ...(margin !== undefined ? { margin: margin ?? null } : {}),
        ...(photo !== undefined ? { photo: photo ?? "" } : {}),
        ...(isActive !== undefined ? { isActive } : {}),
      },
      include: {
        staff: { select: { user: { select: { fullName: true, email: true } } } },
      },
    });

    revalidatePath(REVALIDATE_PATH);

    return {
      success: true,
      message: "L’assignation a bien été mise à jour.",
      assignment: serializeAssignment({
        ...updated,
        staff: updated.staff,
      }),
    };
  } catch (error) {
    console.error("[updateStaffService]", error);
    return {
      success: false,
      message: "Impossible de mettre à jour cette assignation.",
    };
  }
}

export async function deleteStaffService(id) {
  const session = await auth();
  if (!session?.user || !isAdminRole(session.user.role)) {
    return { success: false, message: "Permissions insuffisantes" };
  }

  if (!id) {
    return { success: false, message: "Aucune assignation sélectionnée." };
  }

  try {
    await prisma.staffService.delete({ where: { id } });
    revalidatePath(REVALIDATE_PATH);

    return {
      success: true,
      message: "L’assignation a bien été supprimée.",
    };
  } catch (error) {
    console.error("[deleteStaffService]", error);
    return {
      success: false,
      message: "Impossible de supprimer cette assignation.",
    };
  }
}
