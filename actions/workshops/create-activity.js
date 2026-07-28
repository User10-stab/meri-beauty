"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { isAdminRole } from "@/lib/authorization";
import { serializeDecimalFields } from "@/lib/serialize-prisma";

const activitySchema = z.object({
  type: z.enum(["WORKSHOP", "EVENT"], { required_error: "Le type d'activité est obligatoire." }),
  title: z.string().trim().min(2, "Le titre doit contenir au moins 2 caractères.").max(100, "Le titre ne peut pas dépasser 100 caractères."),
  description: z.string().trim().max(1000, "La description ne peut pas dépasser 1000 caractères.").optional().nullable(),
  cover: z.string().optional().nullable(),
  price: z.coerce.number({ invalid_type_error: "Le prix est invalide." }).nonnegative("Le prix ne peut pas être négatif."),
  duration: z.coerce.number({ invalid_type_error: "La durée est invalide." }).int().positive("La durée doit être supérieure à 0 minutes."),
  language: z.string().trim().optional().nullable(),
  capacity: z.coerce.number({ invalid_type_error: "La capacité est invalide." }).int().positive("La capacité doit être d'au moins 1 personne."),
  animatorId: z.string().optional().nullable(),
  status: z.enum(["DRAFT", "PUBLISHED", "CANCELLED", "ARCHIVED"]).optional().default("DRAFT"),
  allowMultipleSessions: z.boolean().optional().default(false),
});

const updateActivitySchema = activitySchema.extend({
  id: z.string().min(1, "L'identifiant de l'activité est obligatoire."),
});

/**
 * Crée une nouvelle activité.
 */
export async function createActivity(input) {
  try {
    const session = await auth();
    if (!session?.user || !isAdminRole(session.user.role)) {
      return { success: false, message: "Non autorisé." };
    }

    const parsed = activitySchema.safeParse(input);
    if (!parsed.success) {
      const fieldErrors = {};
      parsed.error.errors.forEach((err) => {
        fieldErrors[err.path[0]] = err.message;
      });
      return {
        success: false,
        message: "Veuillez corriger les erreurs du formulaire.",
        errors: fieldErrors,
      };
    }

    const { animatorId, ...rest } = parsed.data;

    // Vérifier si l'animateur existe si fourni
    if (animatorId) {
      const animatorExists = await prisma.animator.findUnique({ where: { id: animatorId } });
      if (!animatorExists) {
        return { success: false, message: "L'animateur sélectionné est introuvable." };
      }
    }

    const activity = await prisma.activity.create({
      data: {
        ...rest,
        animatorId: animatorId || null,
      },
    });

    revalidatePath("/dashboard/workshops");
    return {
      success: true,
      message: "Activité créée avec succès !",
      data: serializeDecimalFields(activity),
    };
  } catch (error) {
    console.error("[createActivity]", error);
    return { success: false, message: "Une erreur est survenue lors de la création de l'activité." };
  }
}

/**
 * Modifie une activité existante.
 */
export async function updateActivity(input) {
  try {
    const session = await auth();
    if (!session?.user || !isAdminRole(session.user.role)) {
      return { success: false, message: "Non autorisé." };
    }

    const parsed = updateActivitySchema.safeParse(input);
    if (!parsed.success) {
      const fieldErrors = {};
      parsed.error.errors.forEach((err) => {
        fieldErrors[err.path[0]] = err.message;
      });
      return {
        success: false,
        message: "Veuillez corriger les erreurs du formulaire.",
        errors: fieldErrors,
      };
    }

    const { id, animatorId, ...rest } = parsed.data;

    // Vérifier si l'activité existe
    const existingActivity = await prisma.activity.findUnique({ where: { id } });
    if (!existingActivity) {
      return { success: false, message: "Activité introuvable." };
    }

    // Vérifier l'animateur si fourni
    if (animatorId) {
      const animatorExists = await prisma.animator.findUnique({ where: { id: animatorId } });
      if (!animatorExists) {
        return { success: false, message: "L'animateur sélectionné est introuvable." };
      }
    }

    const updated = await prisma.activity.update({
      where: { id },
      data: {
        ...rest,
        animatorId: animatorId || null,
      },
    });

    revalidatePath("/dashboard/workshops");
    return {
      success: true,
      message: "Activité mise à jour avec succès !",
      data: serializeDecimalFields(updated),
    };
  } catch (error) {
    console.error("[updateActivity]", error);
    return { success: false, message: "Une erreur est survenue lors de la mise à jour de l'activité." };
  }
}

/**
 * Supprime une activité.
 */
export async function deleteActivity(id) {
  try {
    const session = await auth();
    if (!session?.user || !isAdminRole(session.user.role)) {
      return { success: false, message: "Non autorisé." };
    }

    if (!id) {
      return { success: false, message: "Identifiant manquant." };
    }

    const existingActivity = await prisma.activity.findUnique({ where: { id } });
    if (!existingActivity) {
      return { success: false, message: "Activité introuvable." };
    }

    await prisma.activity.delete({ where: { id } });

    revalidatePath("/dashboard/workshops");
    return { success: true, message: "Activité supprimée avec succès !" };
  } catch (error) {
    console.error("[deleteActivity]", error);
    return { success: false, message: "Une erreur est survenue lors de la suppression de l'activité." };
  }
}
