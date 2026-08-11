"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { hasPermission, DASHBOARD_PERMISSIONS } from "@/lib/authorization";
import { getCurrentStaffId } from "@/lib/route-protection";
import { sendEmail } from "@/lib/email";
import { newsletterEmail } from "@/lib/email-templates";
import { buildUnsubscribeUrl } from "@/lib/newsletter-consent";
import { getAppBaseUrl } from "@/lib/site-url";
import { revalidatePath } from "next/cache";

/**
 * Sends a draft newsletter to all subscribed customers of the salon —
 * every OWNER/ADMIN/STAFF-authored newsletter reaches the same salon-wide
 * audience (client decision, 10 Aug 2026 — createdByStaffId is attribution
 * only, not an audience filter). A STAFF author may only send their own
 * drafts; OWNER/ADMIN may send any.
 * Creates NewsletterRecipient records for each recipient.
 *
 * @param {string} newsletterId
 * @returns {{ success: boolean, message: string, recipientCount?: number }}
 */
export async function sendNewsletter(newsletterId) {
  const session = await auth();
  if (!session?.user || !hasPermission(session.user.role, DASHBOARD_PERMISSIONS.NEWSLETTER)) {
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

    if (session.user.role === "STAFF") {
      const currentStaffId = await getCurrentStaffId();
      if (newsletter.createdByStaffId !== currentStaffId) {
        return { success: false, message: "Vous ne pouvez envoyer que vos propres newsletters." };
      }
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
    const baseUrl = getAppBaseUrl();
    const emailPromises = subscribedUsers.map((user) => {
      const { subject, text, html } = newsletterEmail({
        customerName: user.fullName,
        title: newsletter.title,
        content: newsletter.content,
        salonName,
        unsubscribeUrl: buildUnsubscribeUrl(baseUrl, user.id),
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