"use server";

import { prisma } from "@/lib/prisma";
import { serializeDecimalFields } from "@/lib/serialize-prisma";
import { getAvailableStaffServices } from "@/lib/staff-availability";

/**
 * Get all staff members who provide a specific service and are currently
 * available for booking.
 *
 * This function fetches the raw staff-service data first, then passes it
 * through the reusable availability helper which applies ALL business rules
 * (active contract, working hours, time off, etc.).
 *
 * @param {string} serviceId - The service ID
 * @returns {Promise<{success: boolean, data?: any[], message?: string}>}
 */
export async function getStaffByService(serviceId) {
  try {
    if (!serviceId) {
      return {
        success: false,
        message: "Service ID est requis",
        data: [],
      };
    }

    // Fetch all staff-service records for this service (without availability filtering)
    const staffServices = await prisma.staffService.findMany({
      where: {
        serviceId,
        isActive: true,
        staff: {
          isActive: true,
          isDeleted: false,
          user: {
            isActive: true,
            isDeleted: false,
          },
        },
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
            contracts: {
              where: { status: "ACTIVE" },
              take: 1,
            },
          },
        },
        service: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    // Filter by availability using the reusable helper
    const availableStaffServices = getAvailableStaffServices(staffServices);

    // Calculate average rating for each available staff member
    const staffWithRatings = await Promise.all(
      availableStaffServices.map(async (ss) => {
        const appointments = await prisma.appointment.findMany({
          where: {
            staffServiceId: ss.id,
            review: {
              isNot: null,
            },
          },
          include: {
            review: true,
          },
        });

        const reviews = appointments.map((a) => a.review).filter(Boolean);
        const avgRating =
          reviews.length > 0
            ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length
            : 0;

        return {
          ...ss,
          avgRating: Math.round(avgRating * 10) / 10,
          reviewCount: reviews.length,
        };
      })
    );

    const serializedData = staffWithRatings.map((item) =>
      serializeDecimalFields(item)
    );

    return {
      success: true,
      data: serializedData,
    };
  } catch (error) {
    console.error("[getStaffByService]", error);
    return {
      success: false,
      message: "Erreur lors de la récupération du personnel",
      data: [],
    };
  }
}