"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { isAdminRole } from "@/lib/authorization";

/**
 * Fetches all rental requests with their data. Returns a plain serialisable array.
 *
 * @returns {{ success: boolean, data?: Array<object>, message?: string }}
 */
export async function getRentalRequests() {
  try {
    const session = await auth();
    if (!session?.user || !isAdminRole(session.user.role)) {
      return { success: false, data: [], message: "Permissions insuffisantes" };
    }
    const rentalRequests = await prisma.rentalRequest.findMany({
      where: { isDeleted: false },
      orderBy: { createdAt: "desc" },
      include: {
        user: {
          select: {
            id: true,
            fullName: true,
            email: true,
            phone: true,
            addressLine1: true,
            addressLine2: true,
            addressCity: true,
            addressPostalCode: true,
            addressCountry: true,
          },
        },
      },
    });

    // Les coordonnées saisies dans le formulaire (audit MB-004) priment sur
    // celles du compte : liste, détail, recherche et création du staff les
    // reprennent ainsi sans changement. Anciennes demandes : compte seul.
    const serialised = rentalRequests.map((r) => ({
      id: r.id,
      userId: r.userId,
      user: r.user && {
        ...r.user,
        fullName: [r.firstName, r.lastName].filter(Boolean).join(" ") || r.user.fullName,
        email: r.email || r.user.email,
        phone: r.phone || r.user.phone,
      },
      rentalType: r.rentalType,
      startDate: r.startDate.toISOString(),
      endDate: r.endDate ? r.endDate.toISOString() : null,
      commissionType: r.commissionType,
      status: r.status,
      message: r.message,
      ownerResponse: r.ownerResponse,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    }));

    return { success: true, data: serialised };
  } catch (error) {
    console.error("[getRentalRequests]", error);
    return {
      success: false,
      message: "Impossible de charger la liste des demandes de location.",
      data: [],
    };
  }
}
