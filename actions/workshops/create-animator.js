"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { isAdminRole } from "@/lib/authorization";

const animatorSchema = z.object({
  name: z.string().trim().min(2, "Le nom doit contenir au moins 2 caractères.").max(100, "Le nom ne peut pas dépasser 100 caractères."),
  email: z.preprocess(
    (val) => (val === "" ? null : val),
    z.string().trim().email("L'adresse email est invalide.").nullable().optional()
  ),
  phone: z.preprocess((val) => (val === "" ? null : val), z.string().trim().nullable().optional()),
  bio: z.preprocess((val) => (val === "" ? null : val), z.string().trim().max(500, "La biographie ne peut pas dépasser 500 caractères.").nullable().optional()),
  avatar: z.preprocess((val) => (val === "" ? null : val), z.string().nullable().optional()),
  website: z.preprocess(
    (val) => (val === "" ? null : val),
    z.string().trim().url("L'adresse URL du site web est invalide.").nullable().optional()
  ),
  instagram: z.preprocess((val) => (val === "" ? null : val), z.string().trim().nullable().optional()),
  facebook: z.preprocess((val) => (val === "" ? null : val), z.string().trim().nullable().optional()),
});

const updateAnimatorSchema = animatorSchema.extend({
  id: z.string().min(1, "L'identifiant de l'animateur est obligatoire."),
});

/**
 * Crée un nouvel animateur externe.
 */
export async function createAnimator(input) {
  try {
    const session = await auth();
    if (!session?.user || !isAdminRole(session.user.role)) {
      return { success: false, message: "Non autorisé." };
    }

    const parsed = animatorSchema.safeParse(input);
    if (!parsed.success) {
      const fieldErrors = {};
      parsed.error.issues.forEach((err) => {
        fieldErrors[err.path[0]] = err.message;
      });
      return {
        success: false,
        message: "Veuillez corriger les erreurs du formulaire.",
        errors: fieldErrors,
      };
    }

    const { email } = parsed.data;

    // Si un email est fourni, vérifier qu'il est unique
    if (email) {
      const existingEmail = await prisma.animator.findUnique({ where: { email } });
      if (existingEmail) {
        return {
          success: false,
          message: "Veuillez corriger les erreurs du formulaire.",
          errors: { email: "Cette adresse email est déjà utilisée par un autre animateur." },
        };
      }
    }

    const animator = await prisma.animator.create({
      data: parsed.data,
    });

    revalidatePath("/dashboard/workshops");
    return {
      success: true,
      message: "Animateur créé avec succès !",
      data: animator,
    };
  } catch (error) {
    console.error("[createAnimator]", error);
    return { success: false, message: "Une erreur est survenue lors de la création de l'animateur." };
  }
}

/**
 * Modifie un animateur existant.
 */
export async function updateAnimator(input) {
  try {
    const session = await auth();
    if (!session?.user || !isAdminRole(session.user.role)) {
      return { success: false, message: "Non autorisé." };
    }

    const parsed = updateAnimatorSchema.safeParse(input);
    if (!parsed.success) {
      const fieldErrors = {};
      parsed.error.issues.forEach((err) => {
        fieldErrors[err.path[0]] = err.message;
      });
      return {
        success: false,
        message: "Veuillez corriger les erreurs du formulaire.",
        errors: fieldErrors,
      };
    }

    const { id, email } = parsed.data;

    // Vérifier si l'animateur existe
    const existingAnimator = await prisma.animator.findUnique({ where: { id } });
    if (!existingAnimator) {
      return { success: false, message: "Animateur introuvable." };
    }

    // Si l'email est modifié, vérifier qu'il est unique
    if (email && email !== existingAnimator.email) {
      const existingEmail = await prisma.animator.findUnique({ where: { email } });
      if (existingEmail) {
        return {
          success: false,
          message: "Veuillez corriger les erreurs du formulaire.",
          errors: { email: "Cette adresse email est déjà utilisée par un autre animateur." },
        };
      }
    }

    const updated = await prisma.animator.update({
      where: { id },
      data: parsed.data,
    });

    revalidatePath("/dashboard/workshops");
    return {
      success: true,
      message: "Animateur mis à jour avec succès !",
      data: updated,
    };
  } catch (error) {
    console.error("[updateAnimator]", error);
    return { success: false, message: "Une erreur est survenue lors de la mise à jour de l'animateur." };
  }
}

/**
 * Supprime un animateur.
 */
export async function deleteAnimator(id) {
  try {
    const session = await auth();
    if (!session?.user || !isAdminRole(session.user.role)) {
      return { success: false, message: "Non autorisé." };
    }

    if (!id) {
      return { success: false, message: "Identifiant manquant." };
    }

    const existingAnimator = await prisma.animator.findUnique({ where: { id } });
    if (!existingAnimator) {
      return { success: false, message: "Animateur introuvable." };
    }

    // Vérifier si l'animateur est utilisé par des activités ou des sessions
    const activityCount = await prisma.activity.count({ where: { animatorId: id } });
    const sessionCount = await prisma.workshopSession.count({ where: { animatorId: id } });

    if (activityCount > 0 || sessionCount > 0) {
      return {
        success: false,
        message: `Impossible de supprimer cet animateur car il est associé à ${activityCount} activité(s) et ${sessionCount} session(s).`,
      };
    }

    await prisma.animator.delete({ where: { id } });

    revalidatePath("/dashboard/workshops");
    return { success: true, message: "Animateur supprimé avec succès !" };
  } catch (error) {
    console.error("[deleteAnimator]", error);
    return { success: false, message: "Une erreur est survenue lors de la suppression de l'animateur." };
  }
}
