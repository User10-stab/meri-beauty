"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { ROLES, hasDashboardPermission, STAFF_PERMISSIONS } from "@/lib/authorization";
import { getCurrentStaffId } from "@/lib/route-protection";
import { staffCustomerRelationshipFilters } from "@/lib/staff-customer-scope";

const RECENT_LIMIT = 5;

/**
 * Full detail for the Customers "voir plus" drawer — the list row only
 * carries what the table needs; this adds recent appointments/orders.
 *
 * Same visibility rule as getCustomers: OWNER/ADMIN see anyone, STAFF only
 * a customer they've actually served.
 *
 * @param {string} customerId
 */
export async function getCustomerDetail(customerId) {
  if (!customerId) return { success: false, message: "Identifiant manquant." };

  const session = await auth();
  if (!session?.user) return { success: false, message: "Non authentifié." };
  if (!(await hasDashboardPermission(session.user, STAFF_PERMISSIONS.CUSTOMERS))) {
    return { success: false, message: "Permissions insuffisantes." };
  }

  const userRole = session.user.role;
  let staffId = null;
  let staffRelationshipFilters = null;
  if (userRole === ROLES.STAFF) {
    staffId = await getCurrentStaffId();
    if (!staffId) return { success: false, message: "Profil staff introuvable." };
    staffRelationshipFilters = staffCustomerRelationshipFilters({ staffId, staffUserId: session.user.id });
  }

  try {
    const customer = await prisma.user.findFirst({
      where: {
        id: customerId,
        role: "CUSTOMER",
        isDeleted: false,
        ...(staffRelationshipFilters ? { OR: staffRelationshipFilters } : {}),
      },
      select: {
        id: true,
        fullName: true,
        nickName: true,
        email: true,
        phone: true,
        avatar: true,
        isActive: true,
        emailVerified: true,
        lastLogin: true,
        createdAt: true,
        newsletterSubscribed: true,
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
    });

    if (!customer) return { success: false, message: "Client introuvable." };

    const [appointments, formations, orders] = await Promise.all([
      prisma.appointment.findMany({
        where: {
          userId: customerId,
          isDeleted: false,
          ...(staffId ? { staffService: { staffId } } : {}),
        },
        orderBy: { date: "desc" },
        take: RECENT_LIMIT,
        select: {
          id: true,
          date: true,
          status: true,
          staffService: { select: { service: { select: { name: true } } } },
        },
      }),
      prisma.formationReservation.findMany({
        where: {
          customerId,
          ...(staffId ? { session: { formation: { createdById: session.user.id } } } : {}),
          status: { not: "CANCELLED" },
        },
        orderBy: { createdAt: "desc" },
        take: RECENT_LIMIT,
        select: {
          id: true,
          status: true,
          createdAt: true,
          session: { select: { startDate: true, formation: { select: { title: true } } } },
        },
      }),
      staffId
        ? Promise.resolve([]) // STAFF don't need boutique order history for a customer
        : prisma.order.findMany({
            where: { userId: customerId },
            orderBy: { createdAt: "desc" },
            take: RECENT_LIMIT,
            select: { id: true, orderNumber: true, status: true, totalAmount: true, createdAt: true },
          }),
    ]);

    return {
      success: true,
      data: {
        id: customer.id,
        fullName: customer.fullName,
        nickName: customer.nickName,
        email: customer.email,
        phone: customer.phone,
        avatar: customer.avatar,
        isActive: customer.isActive,
        emailVerified: customer.emailVerified,
        newsletterSubscribed: customer.newsletterSubscribed,
        lastLogin: customer.lastLogin?.toISOString() ?? null,
        joinedAt: customer.createdAt.toISOString(),
        appointmentsCount: customer._count.appointments,
        formationsCount: customer._count.formationReservations,
        recentAppointments: appointments.map((a) => ({
          id: a.id,
          date: a.date.toISOString(),
          status: a.status,
          serviceName: a.staffService?.service?.name ?? "Service",
        })),
        recentFormations: formations.map((reservation) => ({
          id: reservation.id,
          status: reservation.status,
          title: reservation.session.formation.title,
          date: reservation.session.startDate.toISOString(),
        })),
        recentOrders: orders.map((o) => ({
          id: o.id,
          orderNumber: o.orderNumber,
          status: o.status,
          totalAmount: Number(o.totalAmount),
          createdAt: o.createdAt.toISOString(),
        })),
      },
    };
  } catch (error) {
    console.error("[getCustomerDetail]", error);
    return { success: false, message: "Erreur lors du chargement du client." };
  }
}
