"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { isValidVatFormat, normalizeVatNumber, verifyVatWithVies } from "@/lib/vat-validation";
import { buildNewsletterConsentUpdate } from "@/lib/newsletter-consent";
import { billingProfileSchema } from "@/lib/validations/billing-profile";

export async function getMySettings() {
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, message: "Vous devez être connecté(e)." };
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      newsletterSubscribed: true,
      vatNumber: true,
      addressLine1: true,
      addressLine2: true,
      addressCity: true,
      addressPostalCode: true,
      addressCountry: true,
      isCompany: true,
      billingProfile: {
        select: {
          companyLegalName: true,
          companyRegistrationNo: true,
          companyLegalForm: true,
          billingContactName: true,
          purchaseOrderReference: true,
          peppolParticipantId: true,
        },
      },
    },
  });
  if (!user) return { success: false, message: "Utilisateur introuvable." };

  return { success: true, data: user };
}

/**
 * Lets a company customer (isCompany) set/update their B2B legal identity —
 * companyLegalName presence is what makes issueInvoice() emit a B2B invoice
 * instead of B2C (see lib/invoicing.js). No password confirmation, same
 * reasoning as updateMyVatNumber()/updateMyAddress().
 */
export async function updateMyBillingProfile(input) {
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, message: "Vous devez être connecté(e)." };
  }

  const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { isCompany: true } });
  if (!user?.isCompany) {
    return { success: false, message: "Cette section est réservée aux comptes entreprise." };
  }

  const parsed = billingProfileSchema.safeParse(input);
  if (!parsed.success) {
    const fe = parsed.error.flatten().fieldErrors;
    return {
      success: false,
      message: "Veuillez corriger les erreurs.",
      errors: Object.fromEntries(Object.entries(fe).map(([k, v]) => [k, v?.[0] ?? null])),
    };
  }

  const data = {
    companyLegalName: parsed.data.companyLegalName,
    companyRegistrationNo: parsed.data.companyRegistrationNo || null,
    companyLegalForm: parsed.data.companyLegalForm || null,
    billingContactName: parsed.data.billingContactName || null,
    purchaseOrderReference: parsed.data.purchaseOrderReference || null,
    peppolParticipantId: parsed.data.peppolParticipantId || null,
  };

  try {
    await prisma.billingProfile.upsert({
      where: { userId: session.user.id },
      update: data,
      create: { userId: session.user.id, ...data },
    });

    revalidatePath("/profile");
    return { success: true, message: "Identité de facturation enregistrée." };
  } catch (error) {
    console.error("[updateMyBillingProfile]", error);
    return { success: false, message: "Une erreur est survenue." };
  }
}

/**
 * Lets a customer set/update/clear their own B2B VAT number, kept out of
 * updateMyProfile() on purpose — that flow requires the current password to
 * confirm any change (appropriate for email/phone/password), which would be
 * pointless friction for a low-stakes invoicing detail. Mirrors
 * updateNewsletterPreference()'s no-password pattern.
 *
 * A valid-format number is saved as pending when VIES is unavailable. Its
 * validation timestamp remains null, so tax-policy.js cannot use it to grant
 * a 0% intra-Community treatment until VIES has actually confirmed it.
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
      await prisma.user.update({
        where: { id: session.user.id },
        data: { vatNumber: null, vatValidatedAt: null, vatValidationName: null, vatValidationAddress: null },
      });
      revalidatePath("/profile");
      return { success: true, message: "Numéro de TVA supprimé." };
    } catch (error) {
      console.error("[updateMyVatNumber]", error);
      return { success: false, message: "Une erreur est survenue." };
    }
  }

  const normalized = normalizeVatNumber(trimmed);
  if (!isValidVatFormat(normalized)) {
    return { success: false, message: "Numéro de TVA UE invalide. Ajoutez le préfixe pays (BE, FR, DE, NL…)." };
  }

  const viesResult = await verifyVatWithVies(trimmed);
  if (!viesResult.success) {
    try {
      await prisma.user.update({
        where: { id: session.user.id },
        data: {
          isCompany: true,
          vatNumber: normalized,
          vatValidatedAt: null,
          vatValidationName: null,
          vatValidationAddress: null,
        },
      });
      revalidatePath("/profile");
      return {
        success: true,
        verificationPending: true,
        vatNumber: normalized,
        message: "Numéro de TVA enregistré en attente de vérification VIES. La TVA normale reste appliquée jusqu’à sa confirmation.",
      };
    } catch (error) {
      console.error("[updateMyVatNumber] pending VIES save", error);
      return { success: false, message: "Impossible d’enregistrer le numéro de TVA." };
    }
  }
  if (!viesResult.valid) {
    return { success: false, message: "Ce numéro de TVA n'est pas reconnu comme actif par le registre européen VIES." };
  }

  try {
    await prisma.user.update({
      where: { id: session.user.id },
      data: {
        isCompany: true,
        vatNumber: normalized,
        vatValidatedAt: new Date(),
        vatValidationName: viesResult.name ?? null,
        vatValidationAddress: viesResult.address ?? null,
      },
    });

    revalidatePath("/profile");
    return {
      success: true,
      vatNumber: normalized,
      message: viesResult.name
        ? `Numéro de TVA vérifié et enregistré (${viesResult.name}).`
        : "Numéro de TVA vérifié et enregistré.",
    };
  } catch (error) {
    console.error("[updateMyVatNumber]", error);
    return { success: false, message: "Une erreur est survenue." };
  }
}

/** Minimal authenticated checkout profile; avoids exposing the full account. */
export async function getMyCheckoutProfile() {
  const session = await auth();
  if (!session?.user?.id) return { success: false };

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      fullName: true,
      email: true,
      phone: true,
      isCompany: true,
      vatNumber: true,
      vatValidatedAt: true,
    },
  });
  if (!user) return { success: false };

  return {
    success: true,
    data: {
      fullName: user.fullName,
      email: user.email,
      phone: user.phone?.startsWith("temp-") ? "" : (user.phone ?? ""),
      isCompany: user.isCompany,
      vatNumber: user.vatNumber ?? "",
      vatValidatedAt: user.vatValidatedAt,
    },
  };
}

/**
 * Lets a customer set/update their own billing address — mandatory for
 * every account (see lib/validations/register.js), so unlike
 * updateMyVatNumber() there is no "clear" path here. Kept out of
 * updateMyProfile() for the same reason as the VAT number: a low-stakes
 * invoicing detail shouldn't require re-entering the current password.
 *
 * @param {{ addressLine1: string, addressLine2?: string, addressCity: string, addressPostalCode: string, addressCountry: string }} address
 */
export async function updateMyAddress(address) {
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, message: "Vous devez être connecté(e)." };
  }

  const addressLine1 = address?.addressLine1?.trim();
  const addressLine2 = address?.addressLine2?.trim() || null;
  const addressCity = address?.addressCity?.trim();
  const addressPostalCode = address?.addressPostalCode?.trim();
  const addressCountry = address?.addressCountry?.trim() || "BE";

  const errors = {};
  if (!addressLine1 || addressLine1.length < 3) errors.addressLine1 = "L'adresse est obligatoire.";
  if (!addressCity || addressCity.length < 2) errors.addressCity = "La ville est obligatoire.";
  if (!addressPostalCode || addressPostalCode.length < 3) errors.addressPostalCode = "Le code postal est obligatoire.";
  if (Object.keys(errors).length > 0) {
    return { success: false, message: "Veuillez corriger les erreurs.", errors };
  }

  try {
    await prisma.user.update({
      where: { id: session.user.id },
      data: { addressLine1, addressLine2, addressCity, addressPostalCode, addressCountry },
    });

    revalidatePath("/profile");
    return { success: true, message: "Adresse de facturation enregistrée." };
  } catch (error) {
    console.error("[updateMyAddress]", error);
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
