"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { serializeDecimalFields } from "@/lib/serialize-prisma";
import { isAdminRole, ROLES, hasDashboardPermission, STAFF_PERMISSIONS } from "@/lib/authorization";
import { getCurrentStaffId } from "@/lib/route-protection";
import { reportPublicDataError } from "@/lib/prisma-public-fallback";

/**
 * Returns services based on the current user's role.
 * 
 * - OWNER/ADMIN: See all services
 * - STAFF: See only services assigned to them through StaffService
 *
 * This function ONLY fetches data. It does NOT apply any business logic
 * regarding staff availability (contract, working hours, time off, etc.).
 *
 * @returns {{ success: boolean, data: Array<{ id, name, description, category, staffServices, staffNames, price, priceRange, duration, durationRange, margin, marginRange }>, message?: string }}
 */
export async function getServices() {
  try {
    const session = await auth();
    
    if (!session?.user) {
      return {
        success: false,
        data: [],
        message: "Non authentifié",
      };
    }


    if (!(await hasDashboardPermission(session.user, STAFF_PERMISSIONS.SERVICES))) {
      return { success: false, data: [], message: "Permissions insuffisantes" };
    }

    const userRole = session.user.role;
    let whereClause = {};

    // For STAFF, only show services they are assigned to
    if (userRole === ROLES.STAFF) {
      const staffId = await getCurrentStaffId();
      
      if (!staffId) {
        return {
          success: false,
          data: [],
          message: "Profil staff introuvable",
        };
      }

      // Filter services that have at least one StaffService record for this staff member
      whereClause = {
        staffServices: {
          some: {
            staffId: staffId,
            isActive: true,
          },
        },
      };
    }
    // For OWNER/ADMIN, no filtering needed - they see all services

    const services = await prisma.service.findMany({
      where: whereClause,
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
            // For STAFF users, also filter staffServices to only show their own
            ...(userRole === ROLES.STAFF
              ? { staffId: await getCurrentStaffId() }
              : {}),
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
      const serializedService = serializeDecimalFields(s);
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
          ? (minMargin === maxMargin ? `${minMargin} min` : `${minMargin} - ${maxMargin} min`)
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

/**
 * Returns the first 7 services for public display (e.g., footer).
 * This function does NOT require authentication and is accessible to everyone.
 *
 * @returns {{ success: boolean, data: Array<{ id, name, category: { id, name } }>, message?: string }}
 */
export async function getPublicServices() {
  try {
    const services = await prisma.service.findMany({
      take: 7,
      orderBy: [{ category: { name: "asc" } }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        category: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    return { success: true, data: services };
  } catch (error) {
    reportPublicDataError("[getPublicServices]", error);
    return {
      success: false,
      data: [],
      message: "Impossible de charger les services.",
    };
  }
}
