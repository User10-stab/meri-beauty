"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { ROLES } from "@/lib/authorization";
import { getCurrentStaffId } from "@/lib/route-protection";

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

  const userRole = session.user.role;
  let staffId = null;
  if (userRole === ROLES.STAFF) {
    staffId = await getCurrentStaffId();
    if (!staffId) return { success: false, message: "Profil staff introuvable." };
  }

  try {
    const customer = await prisma.user.findFirst({
      where: {
        id: customerId,
        role: "CUSTOMER",
        isDeleted: false,
        ...(staffId
          ? { appointments: { some: { staffService: { staffId }, isDeleted: false } } }
          : {}),
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
        _count: { select: { appointments: true } },
      },
    });

    if (!customer) return { success: false, message: "Client introuvable." };

    const [appointments, orders] = await Promise.all([
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
        recentAppointments: appointments.map((a) => ({
          id: a.id,
          date: a.date.toISOString(),
          status: a.status,
          serviceName: a.staffService?.service?.name ?? "Service",
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
