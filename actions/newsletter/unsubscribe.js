"use server";

import { prisma } from "@/lib/prisma";
import { verifyUnsubscribeToken } from "@/lib/newsletter-consent";

/**
 * Public, unauthenticated by design — clicked straight from an email link,
 * no login required. Security comes from the signed token (tied to one
 * specific userId), not a session check; see lib/newsletter-consent.js.
 */
export async function unsubscribeFromNewsletter(userId, token) {
  if (!userId || !token || !verifyUnsubscribeToken(userId, token)) {
    return { success: false, message: "Ce lien de désabonnement est invalide." };
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, newsletterSubscribed: true },
  });
  if (!user) {
    return { success: false, message: "Compte introuvable." };
  }
  if (!user.newsletterSubscribed) {
    return { success: true, message: "Vous étiez déjà désabonné(e) de notre newsletter." };
  }

  await prisma.user.update({ where: { id: userId }, data: { newsletterSubscribed: false } });

  return { success: true, message: "Vous avez bien été désabonné(e) de notre newsletter." };
}
