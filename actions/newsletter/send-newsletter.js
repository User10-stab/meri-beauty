"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { isAdminRole } from "@/lib/authorization";
import { sendEmail } from "@/lib/email";
import { newsletterEmail } from "@/lib/email-templates";
import { revalidatePath } from "next/cache";

/**
 * Sends a draft newsletter to all subscribed customers of the salon.
 * Creates NewsletterRecipient records for each recipient.
 *
 * @param {string} newsletterId
 * @returns {{ success: boolean, message: string, recipientCount?: number }}
 */
export async function sendNewsletter(newsletterId) {
  const session = await auth();
  if (!session?.user || !isAdminRole(session.user.role)) {
    return { success: false, message: "Permissions insuffisantes" };
  }

  try {
    // ── 1. Get the newsletter ──────────────────────────────────────────────
    const newsletter = await prisma.newsletter.findUnique({
      where: { id: newsletterId },
      include: {
        salon: {
          select: { name: true },
        },
      },
    });

    if (!newsletter) {
      return { success: false, message: "Newsletter introuvable." };
    }

    if (newsletter.status !== "DRAFT") {
      return {
        success: false,
        message: "Cette newsletter a déjà été envoyée ou programmée.",
      };
    }

    // ── 2. Get subscribed customers ────────────────────────────────────────
    const subscribedUsers = await prisma.user.findMany({
      where: {
        newsletterSubscribed: true,
        isDeleted: false,
        role: "CUSTOMER",
      },
      select: {
        id: true,
        fullName: true,
        email: true,
      },
    });

    if (subscribedUsers.length === 0) {
      return {
        success: false,
        message: "Aucun client abonné à la newsletter.",
      };
    }

    // ── 3. Create recipient records ────────────────────────────────────────
    const salonName = newsletter.salon.name;

    await prisma.newsletterRecipient.createMany({
      data: subscribedUsers.map((user) => ({
        newsletterId: newsletter.id,
        userId: user.id,
        status: "SENT",
      })),
    });

    // ── 4. Send emails (non-blocking — fire and forget) ────────────────────
    // We send emails asynchronously without awaiting them all to avoid timeout
    const emailPromises = subscribedUsers.map((user) => {
      const { subject, text, html } = newsletterEmail({
        customerName: user.fullName,
        title: newsletter.title,
        content: newsletter.content,
        salonName,
      });

      return sendEmail({
        to: user.email,
        subject,
        text,
        html,
      }).catch((err) => {
        console.error(`[sendNewsletter] Failed to send to ${user.email}:`, err.message);
        // Mark recipient as FAILED
        return prisma.newsletterRecipient.updateMany({
          where: {
            newsletterId: newsletter.id,
            userId: user.id,
          },
          data: { status: "FAILED" },
        });
      });
    });

    // Fire and forget — don't await all sends to avoid timeout
    Promise.allSettled(emailPromises).catch(() => {});

    // ── 5. Update newsletter status ────────────────────────────────────────
    await prisma.newsletter.update({
      where: { id: newsletter.id },
      data: {
        status: "SENT",
        sentAt: new Date(),
      },
    });

    revalidatePath("/dashboard/newsletter");

    return {
      success: true,
      message: `Newsletter envoyée à ${subscribedUsers.length} abonné(s).`,
      recipientCount: subscribedUsers.length,
    };
  } catch (error) {
    console.error("[sendNewsletter]", error);
    return {
      success: false,
      message: "Une erreur inattendue s'est produite. Veuillez réessayer.",
    };
  }
}