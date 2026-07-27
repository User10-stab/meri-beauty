"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";

/**
 * Toggles the newsletter subscription for the currently authenticated user.
 *
 * Only logged-in users can subscribe/unsubscribe.
 * Does nothing if no user is authenticated.
 *
 * @returns {Promise<{ success: boolean, message: string, subscribed?: boolean }>}
 */
export async function toggleNewsletterSubscription() {
  const session = await auth();

  if (!session?.user?.id) {
    return {
      success: false,
      message: "Vous devez être connecté pour vous inscrire à la newsletter.",
    };
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { id: true, newsletterSubscribed: true },
    });

    if (!user) {
      return { success: false, message: "Utilisateur introuvable." };
    }

    const newStatus = !user.newsletterSubscribed;

    await prisma.user.update({
      where: { id: user.id },
      data: { newsletterSubscribed: newStatus },
    });

    revalidatePath("/");

    return {
      success: true,
      message: newStatus
        ? "Vous êtes abonné à la newsletter !"
        : "Vous êtes désabonné de la newsletter.",
      subscribed: newStatus,
    };
  } catch (error) {
    console.error("[toggleNewsletterSubscription] error:", error);
    return {
      success: false,
      message: "Une erreur est survenue. Veuillez réessayer.",
    };
  }
}