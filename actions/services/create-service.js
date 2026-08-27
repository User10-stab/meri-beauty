"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { isAdminRole, hasDashboardPermission, STAFF_PERMISSIONS, ROLES } from "@/lib/authorization";

const staffAssignmentSchema = z.object({
  staffId: z.string().min(1, "Le professionnel est obligatoire."),
  price: z.coerce.number({ error: "Le prix est invalide." }).nonnegative("Le prix ne peut pas être négatif."),
  duration: z.coerce.number({ error: "La durée est invalide." }).int("La durée doit être un nombre entier.").nonnegative("La durée ne peut pas être négative."),
  margin: z.coerce.number().nonnegative("La marge ne peut pas être négative.").optional().nullable(),
  photo: z.string().optional().nullable(),
});

const createServiceSchema = z.object({
  name: z
    .string({ error: "Le nom du service est obligatoire." })
    .trim()
    .min(2, "Le nom doit contenir au moins 2 caractères.")
    .max(100, "Le nom ne peut pas dépasser 100 caractères."),
  categoryId: z
    .string({ error: "La catégorie est obligatoire." })
    .min(1, "La catégorie est obligatoire."),
  description: z
    .string()
    .trim()
    .max(500, "La description ne peut pas dépasser 500 caractères.")
    .optional()
    .nullable(),
  staffAssignments: z.array(staffAssignmentSchema).optional().default([]),
}).superRefine((data, ctx) => {
  // Validate each staff assignment has price and duration
  (data.staffAssignments || []).forEach((assignment, index) => {
    if (!assignment.price && assignment.price !== 0) {
      ctx.addIssue({
        path: [`staffAssignments`, index, `price`],
        code: z.ZodIssueCode.custom,
        message: "Le prix est obligatoire.",
      });
    }
    if (!assignment.duration) {
      ctx.addIssue({
        path: [`staffAssignments`, index, `duration`],
        code: z.ZodIssueCode.custom,
        message: "La durée est obligatoire.",
      });
    }
  });
});

const updateServiceSchema = z.object({
  id: z.string().min(1, "L'identifiant du service est obligatoire."),
  name: z
    .string({ error: "Le nom du service est obligatoire." })
    .trim()
    .min(2, "Le nom doit contenir au moins 2 caractères.")
    .max(100, "Le nom ne peut pas dépasser 100 caractères."),
  categoryId: z
    .string({ error: "La catégorie est obligatoire." })
    .min(1, "La catégorie est obligatoire."),
  description: z
    .string()
    .trim()
    .max(500, "La description ne peut pas dépasser 500 caractères.")
    .optional()
    .nullable(),
  staffAssignments: z.array(staffAssignmentSchema).optional().default([]),
}).superRefine((data, ctx) => {
  // Validate each staff assignment has price and duration
  (data.staffAssignments || []).forEach((assignment, index) => {
    if (!assignment.price && assignment.price !== 0) {
      ctx.addIssue({
        path: [`staffAssignments`, index, `price`],
        code: z.ZodIssueCode.custom,
        message: "Le prix est obligatoire.",
      });
    }
    if (!assignment.duration) {
      ctx.addIssue({
        path: [`staffAssignments`, index, `duration`],
        code: z.ZodIssueCode.custom,
        message: "La durée est obligatoire.",
      });
    }
  });
});

/**
 * Creates a new service and optionally links it with multiple staff members.
 * Each staff member can have their own price, duration, margin, and photo.
 *
 * @param {{ name: string, categoryId: string, description?: string, staffAssignments?: Array<{ staffId: string, price: number, duration: number, margin?: number, photo?: string }> }} input
 * @returns {{ success: boolean, message: string, service?: { id, name, category } }}
 */
export async function createService(input) {
  const parsed = createServiceSchema.safeParse(input);

  if (!parsed.success) {
    const errors = parsed.error.flatten().fieldErrors;
    return {
      success: false,
      message:
        errors.name?.[0] ??
        errors.categoryId?.[0] ??
        "Données invalides.",
      errors: {
        name: errors.name?.[0] ?? null,
        categoryId: errors.categoryId?.[0] ?? null,
        description: errors.description?.[0] ?? null,
      },
    };
  }

  const { name, categoryId, description, staffAssignments } = parsed.data;

  const session = await auth();
  if (!session?.user) {
    return { success: false, message: "Non authentifié" };
  }
  if (!(await hasDashboardPermission(session.user, STAFF_PERMISSIONS.SERVICES))) {
    return { success: false, message: "Permissions insuffisantes" };
  }

  try {
    // Verify the category exists
    const category = await prisma.category.findUnique({
      where: { id: categoryId },
      select: { id: true, name: true },
    });

    if (!category) {
      return {
        success: false,
        message: "La catégorie sélectionnée est introuvable.",
        errors: {
          categoryId: "Catégorie introuvable.",
        },
      };
    }

    const session = await auth();
    if (!session?.user) {
      return { success: false, message: "Non authentifié" };
    }

    // Check if a service with the same name already exists in this category (case-insensitive)
    const existingService = await prisma.service.findFirst({
      where: {
        categoryId,
        name: {
          equals: name,
          mode: "insensitive",
        },
      },
      select: { id: true, name: true, categoryId: true },
    });

    // STAFF: do not create duplicate global Service records.
    // If the service exists, just create (or re-activate) the StaffService link.
    if (existingService && session.user.role === ROLES.STAFF) {
      const staffRecord = await prisma.staff.findUnique({
        where: { userId: session.user.id, isDeleted: false },
        select: { id: true },
      });

      if (!staffRecord) {
        return { success: false, message: "Profil staff introuvable." };
      }

      const incoming = (staffAssignments || []).find((a) => a.staffId === staffRecord.id);
      if (!incoming) {
        return {
          success: false,
          message: "Veuillez renseigner le prix et la durée.",
          errors: { assignments: [{ price: "Le prix est obligatoire.", duration: "La durée est obligatoire." }] },
        };
      }

      await prisma.staffService.upsert({
        where: { staffId_serviceId: { staffId: staffRecord.id, serviceId: existingService.id } },
        update: {
          price: incoming.price,
          duration: incoming.duration,
          margin: incoming.margin ?? null,
          photo: incoming.photo ?? "",
          isActive: true,
        },
        create: {
          staffId: staffRecord.id,
          serviceId: existingService.id,
          createdById: session.user.id,
          price: incoming.price,
          duration: incoming.duration,
          margin: incoming.margin ?? null,
          photo: incoming.photo ?? "",
          isActive: true,
        },
      });

      revalidatePath("/dashboard/staff/auto-entrepreneur");
      revalidatePath("/dashboard/services");

      return {
        success: true,
        message: `Le service « ${existingService.name} » a été ajouté à votre profil.`,
        service: { id: existingService.id, name: existingService.name },
      };
    }

    // ADMIN/OWNER: keep existing behavior (no duplicates by name globally)
    if (existingService) {
      return {
        success: false,
        message: "Un service avec ce nom existe déjà.",
        errors: { name: "Ce nom est déjà utilisé." },
      };
    }

    const service = await prisma.$transaction(async (tx) => {
      const newService = await tx.service.create({
        data: { name, categoryId, description: description ?? null },
        include: { category: { select: { id: true, name: true } } },
      });

      // Determine createdBy user ID
      let createdById = session.user.id;

      // If staff member, get their staff ID and auto-assign the service to them
      let staffIdToAssign = null;
      if (session.user.role === ROLES.STAFF) {
        const staffRecord = await tx.staff.findUnique({
          where: { userId: session.user.id, isDeleted: false },
          select: { id: true },
        });
        staffIdToAssign = staffRecord?.id;
      }

      // Create staff-service assignments
      const assignmentsToCreate = [];

      // If staff member created this, auto-assign to them with provided pricing
      if (staffIdToAssign) {
        // Staff can provide their own pricing in staffAssignments
        const staffAssignment = (staffAssignments || []).find(a => a.staffId === staffIdToAssign);
        
        assignmentsToCreate.push({
          staffId: staffIdToAssign,
          serviceId: newService.id,
          createdById,
          price: staffAssignment?.price ?? 0,
          duration: staffAssignment?.duration ?? 0,
          margin: staffAssignment?.margin ?? null,
          photo: staffAssignment?.photo ?? "",
          isActive: true,
        });
      }

      // Add any additional staff assignments from the form (admin/owner only)
      if (staffAssignments && staffAssignments.length > 0 && isAdminRole(session.user.role)) {
        for (const assignment of staffAssignments) {
          // Verify staff exists and is active
          const staffExist = await tx.staff.findUnique({
            where: { id: assignment.staffId, isDeleted: false },
            select: { id: true },
          });

          if (staffExist) {
            // Check if already added (avoid duplicates)
            const alreadyAdded = assignmentsToCreate.some(a => a.staffId === staffExist.id);
            if (!alreadyAdded) {
              assignmentsToCreate.push({
                staffId: staffExist.id,
                serviceId: newService.id,
                createdById,
                price: assignment.price ?? 0,
                duration: assignment.duration ?? 0,
                margin: assignment.margin ?? null,
                photo: assignment.photo ?? "",
                isActive: true,
              });
            }
          }
        }
      }

      // Create all assignments
      for (const assignment of assignmentsToCreate) {
        await tx.staffService.create({ data: assignment });
      }

      return newService;
    });

    revalidatePath("/dashboard/staff/auto-entrepreneur");
    revalidatePath("/dashboard/services");

    return {
      success: true,
      message: `Le service « ${service.name} » a été créé avec succès.`,
      service: {
        id: service.id,
        name: service.name,
        description: service.description,
        category: service.category,
      },
    };
  } catch (error) {
    if (error.code === "P2002") {
      return {
        success: false,
        message: "Un service avec ce nom existe déjà.",
        errors: { 
          name: "Ce nom est déjà utilisé.",
        },
      };
    }

    console.error("[createService]", error);
    return {
      success: false,
      message: "Une erreur inattendue s'est produite. Veuillez réessayer.",
    };
  }
}

/**
 * Updates an existing service's core fields (name, category, description).
 * Syncs staff-service assignments: creates new ones, updates existing ones,
 * and removes any that are no longer in the provided list.
 *
 * @param {{ id: string, name: string, categoryId: string, description?: string, staffAssignments?: Array<{ staffId: string, price: number, duration: number, margin?: number, photo?: string }> }} input
 * @returns {{ success: boolean, message: string, service?: object }}
 */
export async function updateService(input) {
  const parsed = updateServiceSchema.safeParse(input);

  if (!parsed.success) {
    const errors = parsed.error.flatten().fieldErrors;
    return {
      success: false,
      message: errors.name?.[0] ?? errors.categoryId?.[0] ?? "Données invalides.",
      errors: {
        name: errors.name?.[0] ?? null,
        categoryId: errors.categoryId?.[0] ?? null,
        description: errors.description?.[0] ?? null,
      },
    };
  }

  const { id, name, categoryId, description, staffAssignments } = parsed.data;

  try {
    const session = await auth();
    if (!session?.user) {
      return { success: false, message: "Non authentifié" };
    }
    if (!(await hasDashboardPermission(session.user, STAFF_PERMISSIONS.SERVICES))) {
      return { success: false, message: "Permissions insuffisantes" };
    }

    // Check if user is admin/owner or if staff member is assigned to this service
    let canEdit = false;
    let staffId = null;

    if (isAdminRole(session.user.role)) {
      canEdit = true;
    } else if (session.user.role === ROLES.STAFF) {
      // Check if this staff member is assigned to the service
      const staffRecord = await prisma.staff.findUnique({
        where: { userId: session.user.id, isDeleted: false },
        select: { id: true },
      });
      
      if (staffRecord) {
        const assignment = await prisma.staffService.findFirst({
          where: { 
            serviceId: id, 
            staffId: staffRecord.id,
            isActive: true 
          },
          select: { id: true },
        });
        
        if (assignment) {
          canEdit = true;
          staffId = staffRecord.id;
        }
      }
    }

    if (!canEdit) {
      return { success: false, message: "Permissions insuffisantes" };
    }

    const service = await prisma.$transaction(async (tx) => {
      // 1. Update the service core fields (only admin/owner can update core fields)
      const updatedService = await tx.service.update({
        where: { id },
        data: { name, categoryId, description: description ?? null },
        include: { category: { select: { id: true, name: true } } },
      });

      // 2. Sync staff-service assignments
      // Get existing assignments for this service
      const existingAssignments = await tx.staffService.findMany({
        where: { serviceId: id },
        select: { id: true, staffId: true },
      });

      const createdById = session.user.id;

      // If staff member, they can only update their own assignment
      if (staffId && !isAdminRole(session.user.role)) {
        // Staff can only update their own staffService record
        const myAssignment = (staffAssignments || []).find(a => a.staffId === staffId);
        
        if (myAssignment) {
          const existing = existingAssignments.find(a => a.staffId === staffId);
          if (existing) {
            await tx.staffService.update({
              where: { id: existing.id },
              data: {
                price: myAssignment.price ?? 0,
                duration: myAssignment.duration ?? 0,
                margin: myAssignment.margin ?? null,
                photo: myAssignment.photo ?? "",
              },
            });
          }
        }
      } else {
        // Admin/Owner can sync all assignments
        const existingStaffIds = existingAssignments.map((a) => a.staffId);
        const incomingStaffIds = (staffAssignments || []).map((a) => a.staffId);

        // Remove assignments that are no longer in the list
        const toRemove = existingAssignments.filter((a) => !incomingStaffIds.includes(a.staffId));
        for (const assignment of toRemove) {
          await tx.staffService.delete({ where: { id: assignment.id } });
        }

        // Upsert assignments for incoming staff
        for (const assignment of staffAssignments || []) {
          const existing = existingAssignments.find((a) => a.staffId === assignment.staffId);

          if (existing) {
            // Update existing assignment
            await tx.staffService.update({
              where: { id: existing.id },
              data: {
                price: assignment.price || 0,
                duration: assignment.duration || 0,
                margin: assignment.margin ?? null,
                photo: assignment.photo ?? "",
              },
            });
          } else {
            // Create new assignment
            const staffExist = await tx.staff.findUnique({
              where: { id: assignment.staffId, isDeleted: false },
              select: { id: true },
            });

            if (staffExist) {
              await tx.staffService.create({
                data: {
                  staffId: assignment.staffId,
                  serviceId: id,
                  createdById,
                  price: assignment.price || 0,
                  duration: assignment.duration || 0,
                  margin: assignment.margin ?? null,
                  photo: assignment.photo ?? "",
                  isActive: true,
                },
              });
            }
          }
        }
      }

      return updatedService;
    });

    revalidatePath("/dashboard/staff/auto-entrepreneur");
    revalidatePath("/dashboard/services");

    return {
      success: true,
      message: `Le service « ${service.name} » a été mis à jour.`,
      service: {
        id: service.id,
        name: service.name,
        description: service.description,
        category: service.category,
      },
    };
  } catch (error) {
    if (error.code === "P2002") {
      return {
        success: false,
        message: "Un service avec ce nom existe déjà.",
        errors: { name: "Ce nom est déjà utilisé." },
      };
    }

    console.error("[updateService]", error);
    return {
      success: false,
      message: "Une erreur inattendue s'est produite. Veuillez réessayer.",
    };
  }
}

/**
 * Deletes a service and its associated StaffService records.
 *
 * @param {string} id - The service ID to delete
 * @returns {{ success: boolean, message: string }}
 */
export async function deleteService(id) {
  if (!id) {
    return { success: false, message: "Aucun service sélectionné." };
  }

  const session = await auth();
  if (!session?.user) {
    return { success: false, message: "Non authentifié" };
  }
  if (!(await hasDashboardPermission(session.user, STAFF_PERMISSIONS.SERVICES))) {
    return { success: false, message: "Permissions insuffisantes" };
  }

  try {
    // Check if user is admin/owner or if staff member is assigned to this service
    let canDelete = false;
    let isStaffDelete = false;
    let staffId = null;

    if (isAdminRole(session.user.role)) {
      canDelete = true;
    } else if (session.user.role === ROLES.STAFF) {
      // Check if this staff member is assigned to the service
      const staffRecord = await prisma.staff.findUnique({
        where: { userId: session.user.id, isDeleted: false },
        select: { id: true },
      });
      
      if (staffRecord) {
        const assignment = await prisma.staffService.findFirst({
          where: { 
            serviceId: id, 
            staffId: staffRecord.id,
            isActive: true 
          },
          select: { id: true },
        });
        
        if (assignment) {
          canDelete = true;
          isStaffDelete = true;
          staffId = staffRecord.id;
        }
      }
    }

    if (!canDelete) {
      return { success: false, message: "Permissions insuffisantes" };
    }

    await prisma.$transaction(async (tx) => {
      if (isStaffDelete) {
        // Staff: only remove their own StaffService relationship
        await tx.staffService.deleteMany({ 
          where: { 
            serviceId: id,
            staffId: staffId
          } 
        });
      } else {
        // Admin/Owner: delete all staff-service associations and the service itself
        await tx.staffService.deleteMany({ where: { serviceId: id } });
        await tx.service.delete({ where: { id } });
      }
    });

    revalidatePath("/dashboard/services");
    revalidatePath("/dashboard/staff/auto-entrepreneur");

    if (isStaffDelete) {
      return { success: true, message: "Le service a été retiré de votre profil." };
    } else {
      return { success: true, message: "Le service a été supprimé." };
    }
  } catch (error) {
    console.error("[deleteService]", error);
    return {
      success: false,
      message: "Impossible de supprimer ce service.",
    };
  }
}

/**
 * Returns all categories for the quick-create dropdown.
 * For STAFF users, also includes the services in each category with
 * an `isAssignedToMe` flag so they can see which services they already
 * offer and add existing services to their profile.
 */
export async function getCategories() {
  try {
    const session = await auth();
    if (!session?.user) {
      return { success: false, data: [], message: "Non authentifié" };
    }
    if (!(await hasDashboardPermission(session.user, STAFF_PERMISSIONS.SERVICES))) {
      return { success: false, data: [], message: "Permissions insuffisantes" };
    }

    // For STAFF users, determine their staff ID to check which services they're already assigned to
    let currentStaffId = null;
    if (session.user.role === ROLES.STAFF) {
      const staff = await prisma.staff.findUnique({
        where: { userId: session.user.id, isDeleted: false },
        select: { id: true },
      });
      currentStaffId = staff?.id ?? null;
    }

    const categories = await prisma.category.findMany({
      orderBy: { name: "asc" },
      include: {
        services: {
          select: {
            id: true,
            name: true,
            _count: { select: { staffServices: { where: { isActive: true } } } },
            staffServices: currentStaffId
              ? {
                  where: { staffId: currentStaffId, isActive: true },
                  select: { id: true },
                }
              : false,
          },
          orderBy: { name: "asc" },
        },
      },
    });

    const data = categories.map((c) => ({
      id: c.id,
      name: c.name,
      services: c.services.map((s) => ({
        id: s.id,
        name: s.name,
        staffServicesCount: s._count.staffServices,
        isAssignedToMe: currentStaffId ? s.staffServices.length > 0 : false,
      })),
    }));

    return { success: true, data };
  } catch (error) {
    console.error("[getCategories]", error);
    return { success: false, data: [], message: "Impossible de charger les catégories." };
  }
}

const createCategorySchema = z.object({
  name: z
    .string({ error: "Le nom de la catégorie est obligatoire." })
    .trim()
    .min(2, "Le nom doit contenir au moins 2 caractères.")
    .max(60, "Le nom ne peut pas dépasser 60 caractères."),
  description: z
    .string()
    .trim()
    .max(300, "La description ne peut pas dépasser 300 caractères.")
    .optional()
    .nullable(),
});

/**
 * Quickly creates a new category from the service quick-create form.
 *
 * @param {{ name: string, description?: string }} input
 * @returns {{ success: boolean, message: string, category?: { id, name } }}
 */
export async function createCategory(input) {
  const session = await auth();
  if (!session?.user || !isAdminRole(session.user.role)) {
    return { success: false, message: "Permissions insuffisantes" };
  }

  const parsed = createCategorySchema.safeParse(input);

  if (!parsed.success) {
    const errors = parsed.error.flatten().fieldErrors;
    return {
      success: false,
      message: errors.name?.[0] ?? "Données invalides.",
      errors: {
        name: errors.name?.[0] ?? null,
        description: errors.description?.[0] ?? null,
      },
    };
  }

  const { name, description } = parsed.data;

  try {
    // Check if a category with the same name already exists (case-insensitive)
    const existingCategory = await prisma.category.findFirst({
      where: {
        name: {
          equals: name,
          mode: 'insensitive',
        },
      },
      select: { id: true, name: true },
    });

    if (existingCategory) {
      return {
        success: false,
        message: "Une catégorie avec ce nom existe déjà.",
        errors: { name: "Ce nom est déjà utilisé." },
      };
    }

    const category = await prisma.category.create({
      data: { name, description: description ?? null },
      select: { id: true, name: true },
    });

    revalidatePath("/dashboard/staff/auto-entrepreneur");

    return {
      success: true,
      message: `La catégorie « ${category.name} » a été créée.`,
      category,
    };
  } catch (error) {
    if (error.code === "P2002") {
      return {
        success: false,
        message: "Une catégorie avec ce nom existe déjà.",
        errors: { name: "Ce nom est déjà utilisé." },
      };
    }

    console.error("[createCategory]", error);
    return {
      success: false,
      message: "Une erreur inattendue s'est produite. Veuillez réessayer.",
    };
  }
}

const updateCategorySchema = z.object({
  id: z.string().min(1, "L'identifiant de la catégorie est obligatoire."),
  name: z
    .string({ error: "Le nom de la catégorie est obligatoire." })
    .trim()
    .min(2, "Le nom doit contenir au moins 2 caractères.")
    .max(60, "Le nom ne peut pas dépasser 60 caractères."),
  description: z
    .string()
    .trim()
    .max(300, "La description ne peut pas dépasser 300 caractères.")
    .optional()
    .nullable(),
});

/**
 * Updates an existing category.
 *
 * @param {{ id: string, name: string, description?: string | null }} input
 * @returns {{ success: boolean, message: string, category?: { id, name, description } }}
 */
export async function updateCategory(input) {
  const session = await auth();
  if (!session?.user || !isAdminRole(session.user.role)) {
    return { success: false, message: "Permissions insuffisantes" };
  }

  const parsed = updateCategorySchema.safeParse(input);

  if (!parsed.success) {
    const errors = parsed.error.flatten().fieldErrors;
    return {
      success: false,
      message: errors.name?.[0] ?? "Données invalides.",
      errors: {
        name: errors.name?.[0] ?? null,
        description: errors.description?.[0] ?? null,
      },
    };
  }

  const { id, name, description } = parsed.data;

  try {
    const category = await prisma.category.update({
      where: { id },
      data: { name, description: description ?? null },
      select: { id: true, name: true, description: true },
    });

    revalidatePath("/dashboard/services");
    revalidatePath("/dashboard/staff/auto-entrepreneur");

    return {
      success: true,
      message: `La catégorie « ${category.name} » a été mise à jour.`,
      category,
    };
  } catch (error) {
    if (error.code === "P2002") {
      return {
        success: false,
        message: "Une catégorie avec ce nom existe déjà.",
        errors: { name: "Ce nom est déjà utilisé." },
      };
    }

    console.error("[updateCategory]", error);
    return {
      success: false,
      message: "Une erreur inattendue s'est produite. Veuillez réessayer.",
    };
  }
}

/**
 * Deletes a category and all associated services.
 *
 * @param {string} id - The category ID to delete
 * @returns {{ success: boolean, message: string }}
 */
export async function deleteCategory(id) {
  const session = await auth();
  if (!session?.user || !isAdminRole(session.user.role)) {
    return { success: false, message: "Permissions insuffisantes" };
  }

  if (!id) {
    return { success: false, message: "Aucune catégorie sélectionnée." };
  }

  try {
    await prisma.$transaction(async (tx) => {
      // Find all services in this category and delete their StaffService records
      const services = await tx.service.findMany({
        where: { categoryId: id },
        select: { id: true },
      });
      const serviceIds = services.map((s) => s.id);

      if (serviceIds.length > 0) {
        await tx.staffService.deleteMany({ where: { serviceId: { in: serviceIds } } });
        await tx.service.deleteMany({ where: { categoryId: id } });
      }

      await tx.category.delete({ where: { id } });
    });

    revalidatePath("/dashboard/services");
    revalidatePath("/dashboard/staff/auto-entrepreneur");

    return { success: true, message: "La catégorie et tous ses services ont été supprimés." };
  } catch (error) {
    console.error("[deleteCategory]", error);
    return {
      success: false,
      message: "Impossible de supprimer cette catégorie.",
    };
  }
}

/**
 * Returns all active staff members for selection dropdowns.
 */
export async function getStaffOptions() {
  const session = await auth();
  if (!session?.user) {
    return { success: false, data: [], message: "Non authentifié" };
  }
  if (!(await hasDashboardPermission(session.user, STAFF_PERMISSIONS.SERVICES))) {
    return { success: false, data: [], message: "Permissions insuffisantes" };
  }

  try {
    // For staff: return only their own profile
    if (session.user.role === ROLES.STAFF) {
      const staff = await prisma.staff.findUnique({
        where: { userId: session.user.id, isDeleted: false },
        select: {
          id: true,
          user: { select: { id: true, fullName: true, email: true } },
        },
      });
      return { success: true, data: staff ? [staff] : [] };
    }

    // For admin/owner: return all active staff
    if (!isAdminRole(session.user.role)) {
      return { success: false, data: [], message: "Permissions insuffisantes" };
    }

    const staff = await prisma.staff.findMany({
      where: { isDeleted: false, user: { isDeleted: false, isActive: true , role: "STAFF"  } },
      orderBy: { user: { fullName: "asc" } },
      select: {
        id: true,
        user: { select: { id: true, fullName: true, email: true } },
      },
    });
    return { success: true, data: staff };
  } catch (error) {
    console.error("[getStaffOptions]", error);
    return { success: false, data: [], message: "Impossible de charger les professionnels." };
  }
}

/**
 * Returns the current staff member's ID and profile for the logged-in user.
 * Works for STAFF role users. Returns null for admin/owner.
 */
export async function getCurrentStaffProfile() {
  const session = await auth();
  if (!session?.user) {
    return { success: false, data: null, message: "Non authentifié" };
  }
  if (!(await hasDashboardPermission(session.user, STAFF_PERMISSIONS.SERVICES))) {
    return { success: false, data: null, message: "Permissions insuffisantes" };
  }

  try {
    const staff = await prisma.staff.findUnique({
      where: { userId: session.user.id, isDeleted: false },
      select: {
        id: true,
        user: { select: { id: true, fullName: true, email: true } },
      },
    });

    return { success: true, data: staff };
  } catch (error) {
    console.error("[getCurrentStaffProfile]", error);
    return { success: false, data: null, message: "Impossible de charger votre profil." };
  }
}
