"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { isAdminRole } from "@/lib/authorization";

/**
 * Fetches all newsletters for the current salon.
 * Only available to ADMIN/OWNER roles.
 *
 * @returns {{ success: boolean, data?: Array<object>, message?: string }}
 */
export async function getNewsletters() {
  try {
    const session = await auth();
    if (!session?.user || !isAdminRole(session.user.role)) {
      return { success: false, data: [], message: "Permissions insuffisantes" };
    }

    // Get the salon associated with this admin user
    // We assume the first salon (single-salon setup for now)
    const salon = await prisma.salon.findFirst({
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });

    if (!salon) {
      return { success: false, data: [], message: "Salon introuvable" };
    }

    const newsletters = await prisma.newsletter.findMany({
      where: { salonId: salon.id },
      orderBy: { createdAt: "desc" },
      include: {
        _count: {
          select: { recipients: true },
        },
      },
    });

    const serialised = newsletters.map((n) => ({
      id: n.id,
      title: n.title,
      subject: n.subject,
      content: n.content,
      status: n.status,
      scheduledAt: n.scheduledAt?.toISOString() ?? null,
      sentAt: n.sentAt?.toISOString() ?? null,
      createdAt: n.createdAt.toISOString(),
      updatedAt: n.updatedAt.toISOString(),
      recipientCount: n._count.recipients,
    }));

    return { success: true, data: serialised };
  } catch (error) {
    console.error("[getNewsletters]", error);
    return {
      success: false,
      data: [],
      message: "Impossible de charger la liste des newsletters.",
    };
  }
}