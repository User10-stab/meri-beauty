"use server";

import { contactFormSchema } from "@/lib/validations/contact";
import { sendEmail } from "@/lib/email";
import {
  contactOwnerNotificationEmail,
  contactVisitorAutoReplyEmail,
} from "@/lib/email-templates";
import { prisma } from "@/lib/prisma";

/**
 * Server action for the public contact form.
 *
 * Validates the input, sends an email to the salon owner with the message,
 * and optionally sends an auto-reply to the visitor.
 *
 * Does NOT store any data in the database.
 *
 * @param {{ name: string, email: string, phone?: string, subject: string, message: string }} input
 * @returns {Promise<{ success: boolean, message: string, errors?: Record<string, string|null> }>}
 */
export async function sendContactMessage(input) {
  // 1. Validate
  const parsed = contactFormSchema.safeParse(input);

  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors;
    return {
      success: false,
      message: "Veuillez corriger les erreurs dans le formulaire.",
      errors: {
        name: fieldErrors.name?.[0] ?? null,
        email: fieldErrors.email?.[0] ?? null,
        phone: fieldErrors.phone?.[0] ?? null,
        subject: fieldErrors.subject?.[0] ?? null,
        message: fieldErrors.message?.[0] ?? null,
      },
    };
  }

  const { name, email, phone, subject, message } = parsed.data;

  try {
    // 2. Fetch salon info (name + email for the owner)
    const salon = await prisma.salon.findFirst({
      select: { name: true, email: true },
    });

    const salonName = salon?.name || "Meri Beauty";
    const salonEmail = salon?.email || null;

    // 3. Send notification to the salon owner
    if (salonEmail) {
      const ownerEmail = contactOwnerNotificationEmail({
        name,
        email,
        phone: phone || null,
        subject,
        message,
        salonName,
      });

      await sendEmail({
        to: salonEmail,
        subject: ownerEmail.subject,
        text: ownerEmail.text,
        html: ownerEmail.html,
      });
    }

    // 4. Send auto-reply to the visitor
    const autoReply = contactVisitorAutoReplyEmail({
      name,
      subject,
      salonName,
      salonEmail: salonEmail || undefined,
    });

    await sendEmail({
      to: email,
      subject: autoReply.subject,
      text: autoReply.text,
      html: autoReply.html,
    });

    return {
      success: true,
      message: "Votre message a été envoyé avec succès ! Nous vous répondrons dans les plus brefs délais.",
    };
  } catch (error) {
    console.error("[sendContactMessage] error:", error);
    return {
      success: false,
      message: "Une erreur est survenue lors de l'envoi de votre message. Veuillez réessayer.",
    };
  }
}