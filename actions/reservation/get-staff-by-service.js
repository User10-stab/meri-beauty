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

    // Calculate average rating for each available staff member — one query
    // for all of them (previously one query per staff member inside the
    // .map() below, i.e. N+1: 10 staff meant 10 round-trips per page load).
    const reviews = await prisma.review.findMany({
      where: {
        appointment: {
          staffServiceId: { in: availableStaffServices.map((ss) => ss.id) },
        },
      },
      select: {
        rating: true,
        appointment: { select: { staffServiceId: true } },
      },
    });

    const ratingsByStaffService = new Map();
    for (const r of reviews) {
      const key = r.appointment.staffServiceId;
      const entry = ratingsByStaffService.get(key) ?? { sum: 0, count: 0 };
      entry.sum += r.rating;
      entry.count += 1;
      ratingsByStaffService.set(key, entry);
    }

    const staffWithRatings = availableStaffServices.map((ss) => {
      const entry = ratingsByStaffService.get(ss.id);
      const avgRating = entry ? entry.sum / entry.count : 0;

      return {
        ...ss,
        avgRating: Math.round(avgRating * 10) / 10,
        reviewCount: entry?.count ?? 0,
      };
    });

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