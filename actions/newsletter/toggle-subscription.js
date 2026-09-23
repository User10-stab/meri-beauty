"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { buildNewsletterConsentUpdate } from "@/lib/newsletter-consent";
import { trackNewUser, trackExistingProspect } from "@/lib/prospects/track-prospect";

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
      select: { id: true, email: true, fullName: true, newsletterSubscribed: true },
    });

    if (!user) {
      return { success: false, message: "Utilisateur introuvable." };
    }

    const newStatus = !user.newsletterSubscribed;

    await prisma.user.update({
      where: { id: user.id },
      data: buildNewsletterConsentUpdate(newStatus, "account_settings"),
    });

    revalidatePath("/");

    // Hook marketing : inscription -> prospect + promotion `engage` ;
    // désinscription -> activité sur le prospect existant.
    if (newStatus) {
      trackNewUser({
        email: user.email,
        fullName: user.fullName,
        source: "email",
        userId: user.id,
        activityType: "newsletter_subscribed",
        activityDescription: "Inscription à la newsletter",
        promoteTo: "engage",
        promoteNote: "Inscription newsletter",
      });
    } else {
      trackExistingProspect(user.email, {
        type: "newsletter_unsubscribed",
        description: "Désinscription de la newsletter",
      });
    }

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