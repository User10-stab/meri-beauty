"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export async function getMySettings() {
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, message: "Vous devez être connecté(e)." };
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { newsletterSubscribed: true },
  });
  if (!user) return { success: false, message: "Utilisateur introuvable." };

  return { success: true, data: user };
}

export async function updateNewsletterPreference(subscribed) {
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, message: "Vous devez être connecté(e)." };
  }

  try {
    await prisma.user.update({
      where: { id: session.user.id },
      data: { newsletterSubscribed: Boolean(subscribed) },
    });

    revalidatePath("/settings");
    return {
      success: true,
      message: subscribed ? "Vous êtes inscrit(e) à la newsletter." : "Vous avez été désinscrit(e) de la newsletter.",
    };
  } catch (error) {
    console.error("[updateNewsletterPreference]", error);
    return { success: false, message: "Une erreur est survenue." };
  }
}
