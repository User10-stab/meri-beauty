"use server";

import { prisma } from "@/lib/prisma";
import { serializeDecimalFields } from "@/lib/serialize-prisma";
import { getBookableStaffServices } from "@/lib/staff-availability";

/**
 * Pré-remplissage pour la réservation rapide depuis la page d'un membre du staff.
 *
 * Réutilise exactement les mêmes règles de visibilité que le parcours normal
 * (getStaffByService / getBookableServices via getBookableStaffServices).
 * Ne contient aucune logique métier propre : disponibilités, horaires,
 * TimeOff, contrats, prix, durée, paiement restent gérés par les étapes
 * existantes (DateTimeStep, ReviewStep, PaymentStep).
 *
 * @param {{ staffId: string, serviceId: string }}
 * @returns {{ success: boolean, data?: { category, service, staff, staffService }, message?: string }}
 */
export async function getQuickBookingPrefill({ staffId, serviceId }) {
  try {
    if (!staffId || !serviceId) {
      return { success: false, message: "Staff et service requis." };
    }

    const staffService = await prisma.staffService.findFirst({
      where: {
        staffId,
        serviceId,
        isActive: true,
        isDeleted: false,
        price: { gte: 0 },
        duration: { gt: 0 },
        staff: {
          isActive: true,
          isDeleted: false,
          user: { isActive: true, isDeleted: false },
        },
        service: { isDeleted: false },
      },
      include: {
        staff: {
          select: {
            id: true,
            isActive: true,
            isDeleted: true,
            type: true,
            languages: true,
            bio: true,
            photo: true,
            yearsOfExperience: true,
            reservationConfirmationMode: true,
            depositEnabled: true,
            depositPercentage: true,
            allowedPaymentMethods: true,
            user: {
              select: {
                id: true,
                isActive: true,
                isDeleted: true,
                fullName: true,
                avatar: true,
              },
            },
            workingHours: true,
            timeOffs: true,
            contracts: { where: { status: "ACTIVE" }, take: 1 },
          },
        },
        service: {
          select: {
            id: true,
            name: true,
            description: true,
            category: { select: { id: true, name: true, description: true } },
          },
        },
      },
    });

    if (!staffService) {
      return { success: false, message: "Ce service n'est pas proposé par ce membre du staff." };
    }

    // Même règle de visibilité que le parcours normal.
    const [bookable] = getBookableStaffServices([serializeDecimalFields(staffService)]);
    if (!bookable) {
      return { success: false, message: "Ce service n'est pas réservable pour le moment." };
    }

    const serialized = serializeDecimalFields(bookable);

    return {
      success: true,
      data: {
        category: serialized.service.category,
        service: {
          id: serialized.service.id,
          name: serialized.service.name,
          description: serialized.service.description ?? null,
          category: serialized.service.category,
        },
        staff: serialized.staff,
        staffService: serialized,
      },
    };
  } catch (error) {
    console.error("[getQuickBookingPrefill]", error);
    return { success: false, message: "Impossible de préparer la réservation rapide." };
  }
}
