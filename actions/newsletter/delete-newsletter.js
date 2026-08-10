"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { hasPermission, DASHBOARD_PERMISSIONS } from "@/lib/authorization";
import { getCurrentStaffId } from "@/lib/route-protection";
import { revalidatePath } from "next/cache";

/**
 * Deletes a draft newsletter (soft-delete via status check, then hard delete).
 * Only DRAFT newsletters can be deleted. A STAFF author may only delete
 * their own drafts; OWNER/ADMIN may delete any.
 *
 * @param {string} newsletterId
 * @returns {{ success: boolean, message: string }}
 */
export async function deleteNewsletter(newsletterId) {
  const session = await auth();
  if (!session?.user || !hasPermission(session.user.role, DASHBOARD_PERMISSIONS.NEWSLETTER)) {
    return { success: false, message: "Permissions insuffisantes" };
  }

  try {
    const existing = await prisma.newsletter.findUnique({
      where: { id: newsletterId },
      select: { status: true, createdByStaffId: true },
    });

    if (!existing) {
      return { success: false, message: "Newsletter introuvable." };
    }

    if (existing.status !== "DRAFT") {
      return {
        success: false,
        message: "Seules les newsletters en brouillon peuvent être supprimées.",
      };
    }

    if (session.user.role === "STAFF") {
      const currentStaffId = await getCurrentStaffId();
      if (existing.createdByStaffId !== currentStaffId) {
        return { success: false, message: "Vous ne pouvez supprimer que vos propres newsletters." };
      }
    }

    // Delete recipients first, then the newsletter
    await prisma.$transaction([
      prisma.newsletterRecipient.deleteMany({
        where: { newsletterId },
      }),
      prisma.newsletter.delete({
        where: { id: newsletterId },
      }),
    ]);

    revalidatePath("/dashboard/newsletter");

    return {
      success: true,
      message: "Newsletter supprimée avec succès.",
    };
  } catch (error) {
    console.error("[deleteNewsletter]", error);
    return {
      success: false,
      message: "Une erreur inattendue s'est produite. Veuillez réessayer.",
    };
  }
}