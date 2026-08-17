"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { hasPermission, DASHBOARD_PERMISSIONS } from "@/lib/authorization";

/**
 * Fetches all newsletters for the current salon — every OWNER/ADMIN/STAFF
 * sees the full salon-wide list (not just their own), so nobody drafts
 * duplicate content without realizing someone already covered it.
 *
 * @returns {{ success: boolean, data?: Array<object>, message?: string }}
 */
export async function getNewsletters() {
  try {
    const session = await auth();
    if (!session?.user || !hasPermission(session.user.role, DASHBOARD_PERMISSIONS.NEWSLETTER)) {
      return { success: false, data: [], message: "Permissions insuffisantes" };
    }

    // Get the salon associated with this admin user
    // We assume the first salon (single-salon setup for now)
    const salon = await prisma.salon.findUnique({
      where: { id: "main-salon" },
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
        createdByStaff: {
          select: { id: true, user: { select: { fullName: true } } },
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
      createdByStaffId: n.createdByStaff?.id ?? null,
      createdByName: n.createdByStaff?.user?.fullName ?? "Salon",
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
