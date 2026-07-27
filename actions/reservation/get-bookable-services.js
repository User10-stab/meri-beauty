"use server";

import { prisma } from "@/lib/prisma";
import { serializeDecimalFields } from "@/lib/serialize-prisma";
import { getAvailableStaffServices } from "@/lib/staff-availability";

/**
 * Returns only services in a given category that have at least one
 * bookable staff member.
 *
 * This function is for the reservation page only.
 * The dashboard uses getServices() which returns all services.
 *
 * @param {string} categoryId - The category to filter by
 * @param {Date}   [referenceDate] - Optional date (defaults to now)
 * @returns {{ success: boolean, data: Array<{ id, name, description, staffServices, priceRange, durationRange, marginRange }>, message?: string }}
 */
export async function getBookableServices(categoryId, referenceDate) {
  try {
    if (!categoryId) {
      return { success: false, data: [], message: "Catégorie requise." };
    }

    const services = await prisma.service.findMany({
      where: { categoryId },
      orderBy: { name: "asc" },
      include: {
        category: { select: { id: true, name: true } },
        staffServices: {
          where: {
            isActive: true,
            staff: {
              isActive: true,
              isDeleted: false,
              user: { isDeleted: false, isActive: true },
            },
          },
          include: {
            staff: {
              include: {
                user: { select: { id: true, fullName: true, email: true } },
                workingHours: true,
                timeOffs: true,
                contracts: {
                  where: { status: "ACTIVE" },
                  take: 1,
                },
              },
            },
          },
        },
      },
    });

    const data = services
      .map((s) => {
        const serialized = serializeDecimalFields(s);
        const availableStaffServices = getAvailableStaffServices(
          serialized.staffServices || [],
          referenceDate
        );

        // Only include services that have at least one available staff member
        if (availableStaffServices.length === 0) return null;

        const prices = availableStaffServices.map((ss) => ss.price);
        const minPrice = prices.length > 0 ? Math.min(...prices) : 0;
        const maxPrice = prices.length > 0 ? Math.max(...prices) : 0;

        const durations = availableStaffServices.map((ss) => ss.duration);
        const minDuration = durations.length > 0 ? Math.min(...durations) : 0;
        const maxDuration = durations.length > 0 ? Math.max(...durations) : 0;

        return {
          id: s.id,
          name: s.name,
          description: s.description ?? null,
          category: s.category,
          staffServices: availableStaffServices,
          priceRange: prices.length > 0
            ? (minPrice === maxPrice ? `€${minPrice.toFixed(2)}` : `€${minPrice.toFixed(2)} - €${maxPrice.toFixed(2)}`)
            : "—",
          durationRange: durations.length > 0
            ? (minDuration === maxDuration ? `${minDuration} min` : `${minDuration} - ${maxDuration} min`)
            : "—",
        };
      })
      .filter(Boolean);

    return { success: true, data };
  } catch (error) {
    console.error("[getBookableServices]", error);
    return {
      success: false,
      data: [],
      message: "Impossible de charger les services disponibles.",
    };
  }
}