"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { isAdminRole, ROLES } from "@/lib/authorization";
import { getCurrentStaffId } from "@/lib/route-protection";

/**
 * Fetch all appointments for the dashboard.
 *
 * - ADMIN / OWNER → every appointment in the salon
 * - STAFF         → only appointments assigned to themselves
 *
 * @returns {Promise<{
 *   success: boolean,
 *   data?: Array<object>,
 *   message?: string
 * }>}
 */
export async function getAllAppointments() {
  try {
    const session = await auth();

    if (!session?.user) {
      return { success: false, message: "Authentification requise" };
    }

    const { role } = session.user;

    // ── Build the where clause ─────────────────────────────────────────────
    let where = { isDeleted: false };

    if (role === ROLES.STAFF) {
      const staffId = await getCurrentStaffId();

      if (!staffId) {
        return { success: false, message: "Profil staff introuvable" };
      }

      where = {
        ...where,
        staffService: {
          staffId,
        },
      };
    } else if (!isAdminRole(role)) {
      return { success: false, message: "Permissions insuffisantes" };
    }

    // ── Query ──────────────────────────────────────────────────────────────
    const appointments = await prisma.appointment.findMany({
      where,
      orderBy: [{ date: "desc" }, { startTime: "desc" }],
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
              select: { id: true, name: true },
            },
            staff: {
              include: {
                user: {
                  select: { fullName: true },
                },
              },
            },
          },
        },
        payment: {
          select: {
            id: true,
            depositAmount: true,
            status: true,
          },
        },
      },
    });

    // ── Serialise ──────────────────────────────────────────────────────────
    const data = appointments.map((appt) => ({
      id: appt.id,
      // Client info
      customerName: appt.user?.fullName ?? "—",
      customerEmail: appt.user?.email ?? "—",
      customerPhone: appt.user?.phone ?? "—",
      // Service & staff
      serviceName: appt.staffService?.service?.name ?? "—",
      staffName: appt.staffService?.staff?.user?.fullName ?? "—",
      // Scheduling
      date: appt.date?.toISOString() ?? null,
      startTime: appt.startTime?.toISOString() ?? null,
      endTime: appt.endTime?.toISOString() ?? null,
      // Status
      status: appt.status,
      notes: appt.notes ?? null,
      // Payment
      paymentStatus: appt.payment?.status ?? null,
      depositAmount: appt.payment?.depositAmount
        ? Number(appt.payment.depositAmount)
        : null,
      // Meta
      createdAt: appt.createdAt?.toISOString() ?? null,
    }));

    return { success: true, data };
  } catch (error) {
    console.error("[getAllAppointments]", error);
    return {
      success: false,
      message: "Erreur lors de la récupération des rendez-vous",
    };
  }
}
