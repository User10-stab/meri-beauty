"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { isAdminRole } from "@/lib/authorization";
import { revalidatePath } from "next/cache";

/**
 * Creates a new newsletter (DRAFT status).
 *
 * @param {{ title: string, subject: string, content: string }} input
 * @returns {{ success: boolean, message: string, errors?: object, newsletterId?: string }}
 */
export async function createNewsletter(input) {
  const session = await auth();
  if (!session?.user || !isAdminRole(session.user.role)) {
    return { success: false, message: "Permissions insuffisantes" };
  }

  // ── 1. Validate ──────────────────────────────────────────────────────────
  const { title, subject, content } = input;

  const errors = {};
  if (!title || typeof title !== "string" || title.trim().length === 0) {
    errors.title = "Le titre est requis.";
  }
  if (!subject || typeof subject !== "string" || subject.trim().length === 0) {
    errors.subject = "L'objet est requis.";
  }
  if (!content || typeof content !== "string" || content.trim().length === 0) {
    errors.content = "Le contenu est requis.";
  }

  if (Object.keys(errors).length > 0) {
    return {
      success: false,
      message: "Veuillez corriger les erreurs dans le formulaire.",
      errors,
    };
  }

  // ── 2. Get the salon ─────────────────────────────────────────────────────
  const salon = await prisma.salon.findFirst({
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });

  if (!salon) {
    return { success: false, message: "Salon introuvable" };
  }

  // ── 3. Create newsletter ─────────────────────────────────────────────────
  try {
    const newsletter = await prisma.newsletter.create({
      data: {
        title: title.trim(),
        subject: subject.trim(),
        content: content.trim(),
        status: "DRAFT",
        salonId: salon.id,
      },
    });

    revalidatePath("/dashboard/newsletter");

    return {
      success: true,
      message: "Newsletter créée avec succès.",
    };
  } catch (error) {
    console.error("[createNewsletter]", error);
    return {
      success: false,
      message: "Une erreur inattendue s'est produite. Veuillez réessayer.",
    };
  }
}