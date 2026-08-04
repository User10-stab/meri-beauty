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
 * @returns {{ success: boolean, data: Array<{ id, fullName, nickName, email, phone, avatar, isActive, lastLogin, createdAt }>, totalCount: number, page: number, pageSize: number, message?: string }}
 */
const DEFAULT_CUSTOMERS_PAGE_SIZE = 20;

export async function getCustomers({ search, page = 1, pageSize = DEFAULT_CUSTOMERS_PAGE_SIZE } = {}) {
  try {
    const session = await auth();

    if (!session?.user) {
      return { success: false, data: [], totalCount: 0, page: 1, pageSize, message: "Non authentifié" };
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
        return { success: false, data: [], totalCount: 0, page: 1, pageSize, message: "Profil staff introuvable" };
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

    if (search) {
      userWhere = {
        ...userWhere,
        OR: [
          { fullName: { contains: search, mode: "insensitive" } },
          { email: { contains: search, mode: "insensitive" } },
          { phone: { contains: search, mode: "insensitive" } },
        ],
      };
    }

    // Unbounded findMany here used to fetch every customer ever registered
    // on every dashboard load — fine at launch, would hang the page at
    // scale. Paginate at the DB level instead.
    const [totalCount, customers] = await Promise.all([
      prisma.user.count({ where: userWhere }),
      prisma.user.findMany({
        where: userWhere,
        orderBy: [{ fullName: "asc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
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
      }),
    ]);

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

    return { success: true, data, totalCount, page, pageSize };
  } catch (error) {
    console.error("[getCustomers]", error);
    return {
      success: false,
      data: [],
      totalCount: 0,
      page,
      pageSize,
      message: "Impossible de charger les clients.",
    };
  }
}