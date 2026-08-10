"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { isValidVatFormat, verifyVatWithVies } from "@/lib/vat-validation";
import { buildNewsletterConsentUpdate } from "@/lib/newsletter-consent";

export async function getMySettings() {
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, message: "Vous devez être connecté(e)." };
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { newsletterSubscribed: true, vatNumber: true },
  });
  if (!user) return { success: false, message: "Utilisateur introuvable." };

  return { success: true, data: user };
}

/**
 * Lets a customer set/update/clear their own B2B VAT number, kept out of
 * updateMyProfile() on purpose — that flow requires the current password to
 * confirm any change (appropriate for email/phone/password), which would be
 * pointless friction for a low-stakes invoicing detail. Mirrors
 * updateNewsletterPreference()'s no-password pattern.
 *
 * Saving requires an active VIES confirmation, not just format/checksum —
 * this is a deliberate settings action with no checkout time pressure, so
 * there's no reason to persist a number nobody has confirmed is real. A
 * network-unreachable VIES is surfaced as "try again later", never silently
 * accepted.
 *
 * @param {string} vatNumber - pass "" to clear a previously saved number.
 */
export async function updateMyVatNumber(vatNumber) {
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, message: "Vous devez être connecté(e)." };
  }

  const trimmed = vatNumber?.trim() || null;

  if (!trimmed) {
    try {
      await prisma.user.update({ where: { id: session.user.id }, data: { vatNumber: null } });
      revalidatePath("/profile");
      return { success: true, message: "Numéro de TVA supprimé." };
    } catch (error) {
      console.error("[updateMyVatNumber]", error);
      return { success: false, message: "Une erreur est survenue." };
    }
  }

  if (!isValidVatFormat(trimmed)) {
    return { success: false, message: "Numéro de TVA invalide (format attendu : BE0123456789)." };
  }

  const viesResult = await verifyVatWithVies(trimmed);
  if (!viesResult.success) {
    return {
      success: false,
      message: viesResult.message || "Le service VIES est actuellement injoignable. Réessayez plus tard.",
    };
  }
  if (!viesResult.valid) {
    return { success: false, message: "Ce numéro de TVA n'est pas reconnu comme actif par le registre européen VIES." };
  }

  try {
    await prisma.user.update({
      where: { id: session.user.id },
      data: { vatNumber: trimmed },
    });

    revalidatePath("/profile");
    return {
      success: true,
      message: viesResult.name
        ? `Numéro de TVA vérifié et enregistré (${viesResult.name}).`
        : "Numéro de TVA vérifié et enregistré.",
    };
  } catch (error) {
    console.error("[updateMyVatNumber]", error);
    return { success: false, message: "Une erreur est survenue." };
  }
}

export async function updateNewsletterPreference(subscribed) {
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, message: "Vous devez être connecté(e)." };
  }

  try {
    await prisma.user.update({
      where: { id: session.user.id },
      data: buildNewsletterConsentUpdate(Boolean(subscribed), "account_settings"),
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
