"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { hasDashboardPermission, STAFF_PERMISSIONS } from "@/lib/authorization";
import { getCurrentStaffId } from "@/lib/route-protection";
import { sendEmail } from "@/lib/email";
import { newsletterEmail } from "@/lib/email-templates";
import { buildUnsubscribeUrl } from "@/lib/newsletter-consent";
import { getAppBaseUrl } from "@/lib/site-url";
import { revalidatePath } from "next/cache";
import { staffCustomerRelationshipFilters } from "@/lib/staff-customer-scope";

/**
 * OWNER/ADMIN sends to all opted-in salon customers. STAFF sends only to
 * opted-in customers linked to their confirmed/completed appointments or
 * formations, and may only send their own drafts.
 * Creates NewsletterRecipient records for each recipient.
 *
 * @param {string} newsletterId
 * @returns {{ success: boolean, message: string, recipientCount?: number }}
 */
export async function sendNewsletter(newsletterId) {
  const session = await auth();
  if (!session?.user || !(await hasDashboardPermission(session.user, STAFF_PERMISSIONS.NEWSLETTER))) {
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

    let currentStaffId = null;
    if (session.user.role === "STAFF") {
      currentStaffId = await getCurrentStaffId();
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
        ...(currentStaffId
          ? {
              OR: staffCustomerRelationshipFilters({
                staffId: currentStaffId,
                staffUserId: session.user.id,
                marketingEligibleOnly: true,
              }),
            }
          : {}),
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

    // ── 3. Send emails (non-blocking — fire and forget) ─────────────────────
    // We send emails asynchronously without awaiting them all to avoid timeout.
    // Recipient rows are created only once a send has actually resolved
    // (SENT or FAILED) — they used to be pre-created as "SENT" up front,
    // before any email had even been attempted, so a crash/restart mid-flight
    // (a PM2 deploy, say) left every not-yet-processed recipient falsely
    // marked delivered with no way to tell a real send from one that was
    // silently dropped. A recipient with no row at all after this run means
    // "never confirmed either way" — honest, and re-sendable.
    const salonName = newsletter.salon.name;
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
      })
        .catch((err) => ({ success: false, error: err?.message ?? String(err) }))
        .then((result) => {
          // sendEmail reports provider failures by resolving { success: false }
          // rather than rejecting (see its own doc comment) — a plain .then()
          // would run on that path too and mark a failed send as SENT. Branch
          // on the result instead of the promise's settle state.
          if (!result?.success) {
            console.error(`[sendNewsletter] Failed to send to ${user.email}:`, result?.error);
          }
          return prisma.newsletterRecipient.create({
            data: { newsletterId: newsletter.id, userId: user.id, status: result?.success ? "SENT" : "FAILED" },
          });
        });
    });

    // Fire and forget — don't await all sends to avoid timeout
    Promise.allSettled(emailPromises).catch(() => {});

    // ── 4. Update newsletter status ────────────────────────────────────────
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
