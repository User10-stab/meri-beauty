"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { isAdminRole } from "@/lib/authorization";

/**
 * Lists every staff account connected to Stripe for the admin
 * "Comptes Stripe" page. Reuses the Stripe fields already stored on the
 * Staff row — no new Stripe API calls, no duplicated logic.
 */
export async function getStripeAccountsForAdmin() {
  try {
    const session = await auth();

    if (!session?.user || !isAdminRole(session.user.role)) {
      return { success: false, data: [], message: "Permissions insuffisantes" };
    }

    const staffList = await prisma.staff.findMany({
      where: {
        stripeAccountId: { not: null },
        isDeleted: false,
        user: { isDeleted: false },
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        isActive: true,
        stripeAccountId: true,
        stripeAccountType: true,
        stripeChargesEnabled: true,
        stripePayoutsEnabled: true,
        allowAdminStripeAccess: true,
        user: {
          select: { fullName: true, email: true, phone: true },
        },
      },
    });

    return {
      success: true,
      data: staffList.map((s) => ({
        id: s.id,
        fullName: s.user.fullName,
        email: s.user.email,
        phone: s.user.phone,
        isActive: s.isActive,
        stripeAccountId: s.stripeAccountId,
        stripeAccountType: s.stripeAccountType,
        stripeChargesEnabled: s.stripeChargesEnabled,
        stripePayoutsEnabled: s.stripePayoutsEnabled,
        // Pre-migration rows default to true at the DB level; the fallback
        // keeps older data readable as "granted".
        allowAdminStripeAccess: s.allowAdminStripeAccess ?? true,
      })),
    };
  } catch (error) {
    console.error("[getStripeAccountsForAdmin]", error);
    return {
      success: false,
      data: [],
      message: "Impossible de charger les comptes Stripe.",
    };
  }
}
