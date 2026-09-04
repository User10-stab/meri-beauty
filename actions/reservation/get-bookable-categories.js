"use server";

import { prisma } from "@/lib/prisma";
import { isStaffServiceBookable } from "@/lib/staff-availability";

/**
 * Returns only categories that have at least one bookable service.
 * A service is bookable if it has at least one StaffService whose
 * staff member passes the visibility check (structural conditions only —
 * a future contract start date does NOT hide the category/service; it
 * only affects which dates are actually bookable, see getAvailableSlots).
 *
 * This function is for the reservation page only.
 * The dashboard uses getCategories() which returns all categories.
 *
 * @returns {{ success: boolean, data: Array<{ id, name, description, servicesCount }>, message?: string }}
 */
export async function getBookableCategories() {
  try {
    const categories = await prisma.category.findMany({
      where: { isDeleted: false },
      orderBy: { name: "asc" },
      include: {
        services: {
          where: { isDeleted: false },
          include: {
            staffServices: {
              where: {
                isActive: true,
                isDeleted: false,
                staff: {
                  isActive: true,
                  isDeleted: false,
                  user: { isDeleted: false, isActive: true },
                },
              },
              include: {
                staff: {
                  include: {
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
        },
      },
    });

    const data = categories
      .map((category) => {
        // Filter to only services that have at least one available staff member
        const bookableServices = category.services.filter((service) => {
          const availableStaffServices = service.staffServices.filter((ss) => {
            const result = isStaffServiceBookable(ss);
            return result.available;
          });
          return availableStaffServices.length > 0;
        });

        return {
          id: category.id,
          name: category.name,
          description: category.description ?? null,
          servicesCount: bookableServices.length,
        };
      })
      .filter((category) => category.servicesCount > 0);

    return { success: true, data };
  } catch (error) {
    console.error("[getBookableCategories]", error);
    return {
      success: false,
      data: [],
      message: "Impossible de charger les catégories disponibles.",
    };
  }
}