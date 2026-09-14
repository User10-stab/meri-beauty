"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { ROLES, hasDashboardPermission, STAFF_PERMISSIONS } from "@/lib/authorization";
import { getCurrentStaffId } from "@/lib/route-protection";
import { staffCustomerRelationshipFilters } from "@/lib/staff-customer-scope";

/**
 * Returns customers based on the current user's role.
 *
 * - OWNER/ADMIN: See all customers
 * - STAFF: See only customers linked to their appointments or formations
 *
 * `createdMonth` ("YYYY-MM") and `staffId` extend the listing so dashboard
 * cards can deep-link their exact counts (e.g. new customers of one month
 * for one staff member). `staffId` is OWNER/ADMIN-only — a STAFF caller
 * stays scoped to their own rows even if they pass another id.
 *
 * @returns {{ success: boolean, data: Array<{ id, fullName, nickName, email, phone, avatar, isActive, createdAt }>, totalCount: number, page: number, pageSize: number, message?: string }}
 */const DEFAULT_CUSTOMERS_PAGE_SIZE = 20;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export async function getCustomers({ search, page = 1, pageSize = DEFAULT_CUSTOMERS_PAGE_SIZE, createdMonth, staffId } = {}) {
  try {
    const session = await auth();

    if (!session?.user) {
      return { success: false, data: [], totalCount: 0, page: 1, pageSize, message: "Non authentifié" };
    }

    if (!(await hasDashboardPermission(session.user, STAFF_PERMISSIONS.CUSTOMERS))) {
      return { success: false, data: [], totalCount: 0, page: 1, pageSize, message: "Permissions insuffisantes" };
    }

    const userRole = session.user.role;
    const isAdmin = userRole === ROLES.ADMIN || userRole === ROLES.OWNER;
    let userWhere = {
      role: "CUSTOMER",
      isDeleted: false,
    };

    // Viewed staff: admins may target any existing member; staff callers
    // are forced back onto their own row.
    let scopeStaffId = null;
    let scopeStaffUserId = session.user.id;
    if (userRole === ROLES.STAFF) {
      scopeStaffId = await getCurrentStaffId();

      if (!scopeStaffId) {
        return { success: false, data: [], totalCount: 0, page: 1, pageSize, message: "Profil staff introuvable" };
      }
    } else if (isAdmin && staffId) {
      const target = await prisma.staff.findUnique({
        where: { id: staffId },
        select: { id: true, userId: true, isDeleted: true },
      });
      if (target && !target.isDeleted) {
        scopeStaffId = target.id;
        scopeStaffUserId = target.userId;
      }
    }

    let staffRelationshipFilters = null;
    if (scopeStaffId) {
      staffRelationshipFilters = staffCustomerRelationshipFilters({
        staffId: scopeStaffId,
        staffUserId: scopeStaffUserId,
      });
      userWhere.AND = [{ OR: staffRelationshipFilters }];
    }

    // Signup-month window (validated — a hand-edited value is ignored).
    if (typeof createdMonth === "string" && MONTH_RE.test(createdMonth)) {
      const [year, monthNumber] = createdMonth.split("-").map(Number);
      userWhere.AND = [
        ...(userWhere.AND ?? []),
        { createdAt: { gte: new Date(year, monthNumber - 1, 1), lt: new Date(year, monthNumber, 1) } },
      ];
    }

    if (search) {
      userWhere.AND = [
        ...(userWhere.AND ?? []),
        { OR: [
          { fullName: { contains: search, mode: "insensitive" } },
          { email: { contains: search, mode: "insensitive" } },
          { phone: { contains: search, mode: "insensitive" } },
        ] },
      ];
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
          isCompany: true,
          vatNumber: true,
          addressLine1: true,
          addressLine2: true,
          addressCity: true,
          addressPostalCode: true,
           addressCountry: true,
           createdAt: true,
          _count: {
            select: {
              appointments: staffRelationshipFilters
                ? { where: staffRelationshipFilters[0].appointments.some }
                : true,
              formationReservations: staffRelationshipFilters
                ? { where: staffRelationshipFilters[1].formationReservations.some }
                : true,
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
      isCompany: c.isCompany,
      vatNumber: c.vatNumber ?? null,
      addressLine1: c.addressLine1 ?? null,
      addressLine2: c.addressLine2 ?? null,
      addressCity: c.addressCity ?? null,
      addressPostalCode: c.addressPostalCode ?? null,
       addressCountry: c.addressCountry ?? null,
       joinedAt: c.createdAt.toISOString(),
      appointmentsCount: c._count.appointments,
      formationsCount: c._count.formationReservations,
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
