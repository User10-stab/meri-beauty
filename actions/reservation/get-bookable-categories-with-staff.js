"use server";

import { prisma } from "@/lib/prisma";
import { isStaffServiceBookable } from "@/lib/staff-availability";

const WEEKDAY_ORDER = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"];
const WEEKDAY_LABELS = {
  MONDAY: "Lun",
  TUESDAY: "Mar",
  WEDNESDAY: "Mer",
  THURSDAY: "Jeu",
  FRIDAY: "Ven",
  SATURDAY: "Sam",
  SUNDAY: "Dim",
};

function getAvailabilitySummary(workingHours) {
  const openHours = (workingHours || [])
    .filter((hour) => !hour.isClosed)
    .sort((a, b) => WEEKDAY_ORDER.indexOf(a.day) - WEEKDAY_ORDER.indexOf(b.day));

  if (openHours.length === 0) {
    return { label: "Indisponible", days: [], hours: null };
  }

  const days = openHours.map((hour) => WEEKDAY_LABELS[hour.day]).join(", ");
  const timeRanges = [...new Set(openHours.map((hour) => `${hour.startTime}–${hour.endTime}`))];

  return {
    label: `${days} · ${timeRanges.length === 1 ? timeRanges[0] : " "}`,
    days: openHours.map((hour) => hour.day),
    hours: timeRanges,
  };
}

/**
 * Returns bookable categories enriched with:
 *   - servicesCount  — number of services that have at least one bookable staff
 *   - staff          — deduplicated list of staff members who offer at least one
 *                      service in this category (id, fullName, photo/avatar,
 *                      and the persisted working-hours availability summary)
 *
 * Used exclusively by the new reservation landing page (category cards + staff
 * preview). The same visibility rules as getBookableCategories apply:
 * structural checks only — a future contract start date does NOT hide the
 * category; it only restricts which dates are actually bookable.
 *
 * @returns {{ success: boolean, data: Array<{
 *   id: string,
 *   name: string,
 *   description: string|null,
 *   servicesCount: number,
 *   staff: Array<{ id: string, fullName: string, photo: string|null, availability: object }>
 * }>, message?: string }}
 */
export async function getBookableCategoriesWithStaff() {
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
                price: { gte: 0 },
                duration: { gt: 0 },
                staff: {
                  isActive: true,
                  isDeleted: false,
                  user: { isDeleted: false, isActive: true },
                },
              },
              include: {
                staff: {
                  include: {
                    user: {
                      select: { id: true, fullName: true, avatar: true },
                    },
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
        // Collect bookable staff services across all services in this category
        const staffMap = new Map(); // staffId → { id, fullName, photo }

        let bookableServicesCount = 0;

        for (const service of category.services) {
          const bookableForService = service.staffServices.filter((ss) => {
            const result = isStaffServiceBookable(ss);
            return result.available;
          });

          if (bookableForService.length > 0) {
            bookableServicesCount++;
            for (const ss of bookableForService) {
              if (!staffMap.has(ss.staff.id)) {
                staffMap.set(ss.staff.id, {
                  id: ss.staff.id,
                  fullName: ss.staff.user.fullName,
                  // prefer staff-specific photo, fall back to user avatar
                  photo: ss.staff.photo || ss.staff.user.avatar || null,
                  availability: getAvailabilitySummary(ss.staff.workingHours),
                });
              }
            }
          }
        }

        if (bookableServicesCount === 0) return null;

        return {
          id: category.id,
          name: category.name,
          description: category.description ?? null,
          servicesCount: bookableServicesCount,
          staff: Array.from(staffMap.values()),
        };
      })
      .filter(Boolean);

    return { success: true, data };
  } catch (error) {
    console.error("[getBookableCategoriesWithStaff]", error);
    return {
      success: false,
      data: [],
      message: "Impossible de charger les catégories disponibles.",
    };
  }
}
