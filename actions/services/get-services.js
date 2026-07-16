"use server";

import { prisma } from "@/lib/prisma";
import { serializeDecimalFields } from "@/lib/serialize-prisma";

/**
 * Returns all staff services with their details, serialised for client components.
 *
 * @returns {{ success: boolean, data: Array<{ id, name, description, category: { id, name }, price, duration, margin, photo, isActive }>, message?: string }}
 */
export async function getServices() {
  try {
    const services = await prisma.service.findMany({
      orderBy: [{ category: { name: "asc" } }, { name: "asc" }],
      include: {
        category: { select: { id: true, name: true } },
        staffServices: {
          where: {
            isActive: true,
            staff: {
              isDeleted: false,
              user: { isDeleted: false, isActive: true },
            },
          },
          include: {
            staff: {
              include: {
                user: { select: { id: true, fullName: true, email: true } },
              },
            },
          },
        },
      },
    });

    const data = services.map((s) => {
      // Serialize the entire service object to handle Decimal fields
      const serializedService = serializeDecimalFields(s);
      
      // Extract staffServices from serialized service
      const serializedStaffServices = serializedService.staffServices || [];

      const prices = serializedStaffServices.map((ss) => ss.price);
      const minPrice = prices.length > 0 ? Math.min(...prices) : 0;
      const maxPrice = prices.length > 0 ? Math.max(...prices) : 0;

      const durations = serializedStaffServices.map((ss) => ss.duration);
      const minDuration = durations.length > 0 ? Math.min(...durations) : 0;
      const maxDuration = durations.length > 0 ? Math.max(...durations) : 0;

      const margins = serializedStaffServices
        .map((ss) => ss.margin)
        .filter((m) => m !== null && m !== undefined);
      const minMargin = margins.length > 0 ? Math.min(...margins) : 0;
      const maxMargin = margins.length > 0 ? Math.max(...margins) : 0;

      const staffNames = serializedStaffServices
        .map((ss) => ss.staff?.user?.fullName)
        .filter(Boolean)
        .join(", ");

      return {
        id: s.id,
        name: s.name,
        description: s.description ?? null,
        category: s.category,
        staffServices: serializedStaffServices,
        staffNames: staffNames || "—",
        price: minPrice,
        priceRange: prices.length > 0
          ? (minPrice === maxPrice ? `€${minPrice.toFixed(2)}` : `€${minPrice.toFixed(2)} - €${maxPrice.toFixed(2)}`)
          : "—",
        duration: minDuration,
        durationRange: durations.length > 0
          ? (minDuration === maxDuration ? `${minDuration} min` : `${minDuration} - ${maxDuration} min`)
          : "—",
        margin: minMargin,
        marginRange: margins.length > 0
          ? (minMargin === maxMargin ? `${minMargin}%` : `${minMargin} - ${maxMargin}%`)
          : "—",
      };
    });

    return { success: true, data };
  } catch (error) {
    console.error("[getServices]", error);
    return {
      success: false,
      data: [],
      message: "Impossible de charger les services.",
    };
  }
}
