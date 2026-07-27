"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { ROLES } from "@/lib/authorization";
import { getCurrentStaffId } from "@/lib/route-protection";

/**
 * Returns customers based on the current user's role.
 *
 * - OWNER/ADMIN: See all customers
 * - STAFF: See only customers who have at least one appointment with them
 *
 * @returns {{ success: boolean, data: Array<{ id, fullName, nickName, email, phone, avatar, isActive, lastLogin, createdAt }>, message?: string }}
 */
export async function getCustomers() {
  try {
    const session = await auth();

    if (!session?.user) {
      return { success: false, data: [], message: "Non authentifié" };
    }

    const userRole = session.user.role;
    let userWhere = {
      role: "CUSTOMER",
      isDeleted: false,
    };

    // For STAFF, only show customers who have appointments with them
    if (userRole === ROLES.STAFF) {
      const staffId = await getCurrentStaffId();

      if (!staffId) {
        return { success: false, data: [], message: "Profil staff introuvable" };
      }

      userWhere = {
        ...userWhere,
        appointments: {
          some: {
            staffService: {
              staffId: staffId,
            },
            isDeleted: false,
          },
        },
      };
    }

    const customers = await prisma.user.findMany({
      where: userWhere,
      orderBy: [{ fullName: "asc" }],
      select: {
        id: true,
        fullName: true,
        nickName: true,
        email: true,
        phone: true,
        avatar: true,
        isActive: true,
        lastLogin: true,
        createdAt: true,
        _count: {
          select: {
            appointments: true,
          },
        },
      },
    });

    const data = customers.map((c) => ({
      id: c.id,
      fullName: c.fullName,
      nickName: c.nickName ?? null,
      email: c.email,
      phone: c.phone,
      avatar: c.avatar ?? null,
      isActive: c.isActive,
      lastLogin: c.lastLogin?.toISOString() ?? null,
      joinedAt: c.createdAt.toISOString(),
      appointmentsCount: c._count.appointments,
    }));

    return { success: true, data };
  } catch (error) {
    console.error("[getCustomers]", error);
    return {
      success: false,
      data: [],
      message: "Impossible de charger les clients.",
    };
  }
}