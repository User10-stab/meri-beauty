"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { isAdminRole, ROLES } from "@/lib/authorization";
import { getCurrentStaffId } from "@/lib/route-protection";

/**
 * Fetch CONFIRMED appointments for the calendar within a date range.
 *
 * - ADMIN / OWNER  → every confirmed appointment in the salon
 * - STAFF          → only confirmed appointments assigned to themselves
 *
 * @param {{ from: string, to: string }} range  ISO date strings (inclusive)
 * @returns {Promise<{ success: boolean, data?: Array<CalendarAppointment>, message?: string }>}
 */
export async function getCalendarAppointments({ from, to }) {
  try {
    const session = await auth();

    if (!session?.user) {
      return { success: false, message: "Authentification requise" };
    }

    const { role } = session.user;

    // ── Base filter ────────────────────────────────────────────────────────
    const fromDate = new Date(from);
    const toDate = new Date(to);
    // Include end of toDate (23:59:59)
    toDate.setHours(23, 59, 59, 999);

    let where = {
      isDeleted: false,
      status: "CONFIRMED",
      date: {
        gte: fromDate,
        lte: toDate,
      },
    };

    // ── Role filter ────────────────────────────────────────────────────────
    if (role === ROLES.STAFF) {
      const staffId = await getCurrentStaffId();
      if (!staffId) {
        return { success: false, message: "Profil staff introuvable" };
      }
      where = {
        ...where,
        staffService: { staffId },
      };
    } else if (!isAdminRole(role)) {
      return { success: false, message: "Permissions insuffisantes" };
    }

    // ── Query ──────────────────────────────────────────────────────────────
    const appointments = await prisma.appointment.findMany({
      where,
      orderBy: [{ date: "asc" }, { startTime: "asc" }],
      include: {
        user: {
          select: {
            id: true,
            fullName: true,
            email: true,
            phone: true,
          },
        },
        staffService: {
          include: {
            service: {
              select: {
                id: true,
                name: true,
                category: { select: { id: true, name: true } },
              },
            },
            staff: {
              select: {
                id: true,
                photo: true,
                user: { select: { id: true, fullName: true } },
              },
            },
          },
        },
        payment: {
          select: {
            id: true,
            totalAmount: true,
            depositAmount: true,
            paidAmount: true,
            remainingAmount: true,
            status: true,
            paymentType: true,
          },
        },
      },
    });

    // ── Serialise ──────────────────────────────────────────────────────────
    const data = appointments.map((appt) => {
      const staffService = appt.staffService;
      const staff = staffService?.staff;

      return {
        id: appt.id,
        // Customer
        customerId: appt.user?.id ?? null,
        customerName: appt.user?.fullName ?? "—",
        customerEmail: appt.user?.email ?? "—",
        customerPhone: appt.user?.phone ?? "—",
        // Service
        serviceId: staffService?.service?.id ?? null,
        serviceName: staffService?.service?.name ?? "—",
        categoryId: staffService?.service?.category?.id ?? null,
        categoryName: staffService?.service?.category?.name ?? "—",
        // Staff
        staffId: staff?.id ?? null,
        staffName: staff?.user?.fullName ?? "—",
        staffPhoto: staff?.photo ?? null,
        // Pricing & duration
        price: staffService?.price ? Number(staffService.price) : null,
        duration: staffService?.duration ?? null,
        // Scheduling
        date: appt.date?.toISOString() ?? null,
        startTime: appt.startTime?.toISOString() ?? null,
        endTime: appt.endTime?.toISOString() ?? null,
        // Status & notes
        status: appt.status,
        notes: appt.notes ?? null,
        // Payment
        paymentId: appt.payment?.id ?? null,
        paymentStatus: appt.payment?.status ?? null,
        paymentType: appt.payment?.paymentType ?? null,
        totalAmount: appt.payment?.totalAmount
          ? Number(appt.payment.totalAmount)
          : null,
        depositAmount: appt.payment?.depositAmount
          ? Number(appt.payment.depositAmount)
          : null,
        paidAmount: appt.payment?.paidAmount
          ? Number(appt.payment.paidAmount)
          : null,
        remainingAmount: appt.payment?.remainingAmount
          ? Number(appt.payment.remainingAmount)
          : null,
        // Meta
        createdAt: appt.createdAt?.toISOString() ?? null,
      };
    });

    return { success: true, data };
  } catch (error) {
    console.error("[getCalendarAppointments]", error);
    return {
      success: false,
      message: "Erreur lors de la récupération du calendrier",
    };
  }
}
