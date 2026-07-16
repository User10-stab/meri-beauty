"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";

const createServiceSchema = z.object({
  name: z
    .string({ required_error: "Le nom du service est obligatoire." })
    .trim()
    .min(2, "Le nom doit contenir au moins 2 caractères.")
    .max(100, "Le nom ne peut pas dépasser 100 caractères."),
  categoryId: z
    .string({ required_error: "La catégorie est obligatoire." })
    .min(1, "La catégorie est obligatoire."),
  description: z
    .string()
    .trim()
    .max(500, "La description ne peut pas dépasser 500 caractères.")
    .optional()
    .nullable(),
  selectedStaffId: z
    .string()
    .optional()
    .nullable(),
  price: z
    .number()
    .min(0, "Le prix ne peut pas être négatif.")
    .optional()
    .nullable(),
  duration: z
    .number()
    .int("La durée doit être un nombre entier.")
    .min(1, "La durée doit être d'au moins 1 minute.")
    .optional()
    .nullable(),
  margin: z
    .number()
    .min(0, "La marge ne peut pas être négative.")
    .optional()
    .nullable(),
  photo: z
    .string()
    .optional()
    .nullable(),
}).superRefine((data, ctx) => {
  // If staff is selected, price and duration are required
  if (data.selectedStaffId) {
    if (data.price === null || data.price === undefined) {
      ctx.addIssue({
        path: ["price"],
        code: z.ZodIssueCode.custom,
        message: "Le prix est obligatoire lorsque vous associez un professionnel.",
      });
    }
    if (data.duration === null || data.duration === undefined) {
      ctx.addIssue({
        path: ["duration"],
        code: z.ZodIssueCode.custom,
        message: "La durée est obligatoire lorsque vous associez un professionnel.",
      });
    }
  }
});

const updateServiceSchema = z.object({
  id: z.string().min(1, "L'identifiant du service est obligatoire."),
  name: z
    .string({ required_error: "Le nom du service est obligatoire." })
    .trim()
    .min(2, "Le nom doit contenir au moins 2 caractères.")
    .max(100, "Le nom ne peut pas dépasser 100 caractères."),
  categoryId: z
    .string({ required_error: "La catégorie est obligatoire." })
    .min(1, "La catégorie est obligatoire."),
  description: z
    .string()
    .trim()
    .max(500, "La description ne peut pas dépasser 500 caractères.")
    .optional()
    .nullable(),
  selectedStaffId: z
    .string()
    .optional()
    .nullable(),
  price: z
    .number()
    .min(0, "Le prix ne peut pas être négatif.")
    .optional()
    .nullable(),
  duration: z
    .number()
    .int("La durée doit être un nombre entier.")
    .min(1, "La durée doit être d'au moins 1 minute.")
    .optional()
    .nullable(),
  margin: z
    .number()
    .min(0, "La marge ne peut pas être négative.")
    .optional()
    .nullable(),
  photo: z
    .string()
    .optional()
    .nullable(),
}).superRefine((data, ctx) => {
  if (data.selectedStaffId) {
    if (data.price === null || data.price === undefined) {
      ctx.addIssue({
        path: ["price"],
        code: z.ZodIssueCode.custom,
        message: "Le prix est obligatoire lorsque vous associez un professionnel.",
      });
    }
    if (data.duration === null || data.duration === undefined) {
      ctx.addIssue({
        path: ["duration"],
        code: z.ZodIssueCode.custom,
        message: "La durée est obligatoire lorsque vous associez un professionnel.",
      });
    }
  }
});

/**
 * Creates a new service and optionally links it with a single staff member.
 *
 * @param {{ name: string, categoryId: string, description?: string, selectedStaffId?: string, price?: number, duration?: number, margin?: number, photo?: string }} input
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
        selectedStaffId: errors.selectedStaffId?.[0] ?? null,
        price: errors.price?.[0] ?? null,
        duration: errors.duration?.[0] ?? null,
        margin: errors.margin?.[0] ?? null,
        photo: errors.photo?.[0] ?? null,
      },
    };
  }

  const { name, categoryId, description, selectedStaffId, price, duration, margin, photo } = parsed.data;

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
          selectedStaffId: null,
          price: null,
          duration: null,
          margin: null,
        },
      };
    }

    const session = await auth();

    const service = await prisma.$transaction(async (tx) => {
      const newService = await tx.service.create({
        data: { name, categoryId, description: description ?? null },
        include: { category: { select: { id: true, name: true } } },
      });

      if (selectedStaffId) {
        // Verify staff exists and is active
        const staffExist = await tx.staff.findUnique({
          where: { id: selectedStaffId, isDeleted: false },
          select: { id: true },
        });

        if (staffExist) {
          let createdById = session?.user?.id;
          if (!createdById) {
            const firstUser = await tx.user.findFirst({ select: { id: true }});
            createdById = firstUser?.id;
          }
          if (!createdById) {
            const anyUser = await tx.user.findFirst();
            createdById = anyUser?.id;
          }

          if (createdById) {
            await tx.staffService.create({
              data: {
                staffId: staffExist.id,
                serviceId: newService.id,
                createdById,
                price: price || 0,
                duration: duration || 0,
                margin: margin ?? null,
                photo: photo ?? "",
                isActive: true,
              },
            });
          }
        }
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
          selectedStaffId: null,
          price: null,
          duration: null,
          margin: null,
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
 * Also manages the single StaffService association: creates, updates, or removes it.
 *
 * @param {{ id: string, name: string, categoryId: string, description?: string, selectedStaffId?: string, price?: number, duration?: number, margin?: number, photo?: string }} input
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
        selectedStaffId: errors.selectedStaffId?.[0] ?? null,
        price: errors.price?.[0] ?? null,
        duration: errors.duration?.[0] ?? null,
        margin: errors.margin?.[0] ?? null,
        photo: errors.photo?.[0] ?? null,
      },
    };
  }

  const { id, name, categoryId, description, selectedStaffId, price, duration, margin, photo } = parsed.data;

  try {
    const session = await auth();

    const service = await prisma.$transaction(async (tx) => {
      // 1. Update the service core fields
      const updatedService = await tx.service.update({
        where: { id },
        data: { name, categoryId, description: description ?? null },
        include: { category: { select: { id: true, name: true } } },
      });

      // 2. Handle staff association
      // Find existing StaffService for this service (we only support one)
      const existingAssignment = await tx.staffService.findFirst({
        where: { serviceId: id },
        select: { id: true, staffId: true },
      });

      if (selectedStaffId) {
        if (existingAssignment) {
          // Update existing assignment
          await tx.staffService.update({
            where: { id: existingAssignment.id },
            data: {
              staffId: selectedStaffId,
              price: price || 0,
              duration: duration || 0,
              margin: margin ?? null,
              photo: photo ?? "",
            },
          });
        } else {
          // Create new assignment
          let createdById = session?.user?.id;
          if (!createdById) {
            const firstUser = await tx.user.findFirst({ select: { id: true } });
            createdById = firstUser?.id;
          }
          if (!createdById) {
            const anyUser = await tx.user.findFirst();
            createdById = anyUser?.id;
          }

          if (createdById) {
            await tx.staffService.create({
              data: {
                staffId: selectedStaffId,
                serviceId: id,
                createdById,
                price: price || 0,
                duration: duration || 0,
                margin: margin ?? null,
                photo: photo ?? "",
                isActive: true,
              },
            });
          }
        }
      } else {
        // No staff selected — remove existing assignment if any
        if (existingAssignment) {
          await tx.staffService.delete({ where: { id: existingAssignment.id } });
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

  try {
    await prisma.$transaction(async (tx) => {
      // Delete all staff-service associations
      await tx.staffService.deleteMany({ where: { serviceId: id } });
      // Delete the service itself
      await tx.service.delete({ where: { id } });
    });

    revalidatePath("/dashboard/services");
    revalidatePath("/dashboard/staff/auto-entrepreneur");

    return { success: true, message: "Le service a été supprimé." };
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
 */
export async function getCategories() {
  try {
    const categories = await prisma.category.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    });
    return { success: true, data: categories };
  } catch (error) {
    console.error("[getCategories]", error);
    return { success: false, data: [], message: "Impossible de charger les catégories." };
  }
}

const createCategorySchema = z.object({
  name: z
    .string({ required_error: "Le nom de la catégorie est obligatoire." })
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
    .string({ required_error: "Le nom de la catégorie est obligatoire." })
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
  try {
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