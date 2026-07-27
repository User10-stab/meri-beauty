"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { isAdminRole } from "@/lib/authorization";
import { revalidatePath } from "next/cache";

/**
 * Updates a draft newsletter.
 * Only DRAFT newsletters can be edited.
 *
 * @param {string} newsletterId
 * @param {{ title: string, subject: string, content: string }} input
 * @returns {{ success: boolean, message: string, errors?: object }}
 */
export async function updateNewsletter(newsletterId, input) {
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

  // ── 2. Check newsletter exists and is DRAFT ──────────────────────────────
  try {
    const existing = await prisma.newsletter.findUnique({
      where: { id: newsletterId },
      select: { status: true },
    });

    if (!existing) {
      return { success: false, message: "Newsletter introuvable." };
    }

    if (existing.status !== "DRAFT") {
      return {
        success: false,
        message: "Seules les newsletters en brouillon peuvent être modifiées.",
      };
    }

    // ── 3. Update ──────────────────────────────────────────────────────────
    await prisma.newsletter.update({
      where: { id: newsletterId },
      data: {
        title: title.trim(),
        subject: subject.trim(),
        content: content.trim(),
      },
    });

    revalidatePath("/dashboard/newsletter");

    return {
      success: true,
      message: "Newsletter mise à jour avec succès.",
    };
  } catch (error) {
    console.error("[updateNewsletter]", error);
    return {
      success: false,
      message: "Une erreur inattendue s'est produite. Veuillez réessayer.",
    };
  }
}