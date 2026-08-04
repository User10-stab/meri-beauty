"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { isAdminRole } from "@/lib/authorization";

/**
 * Per-staff performance snapshot for admin monitoring: appointment counts by
 * status and revenue/commission figures, computed from raw per-appointment
 * data so the client can re-aggregate for any date range without refetching.
 * Revenue is scoped to appointments only — workshops/formations are run by
 * the separate, unlinked Animator directory, not by Staff.
 *
 * @returns {{ success: boolean, data?: Array<object>, message?: string }}
 */
export async function getStaffPerformance() {
  try {
    const session = await auth();
    if (!session?.user || !isAdminRole(session.user.role)) {
      return { success: false, data: [], message: "Permissions insuffisantes" };
    }

    const staffList = await prisma.staff.findMany({
      where: { isDeleted: false, user: { isDeleted: false } },
      orderBy: { user: { fullName: "asc" } },
      select: {
        id: true,
        type: true,
        isActive: true,
        user: { select: { id: true, fullName: true, email: true } },
        contracts: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { type: true, commissionPercentage: true, fixedRent: true, status: true },
        },
        staffServices: {
          select: {
            service: { select: { name: true } },
            appointments: {
              where: { isDeleted: false },
              select: {
                id: true,
                status: true,
                startTime: true,
                payment: { select: { status: true, totalAmount: true, paidAmount: true } },
              },
            },
          },
        },
      },
    });

    const data = staffList.map((s) => {
      const appointments = s.staffServices.flatMap((ss) =>
        ss.appointments.map((a) => ({
          id: a.id,
          date: a.startTime.toISOString(),
          status: a.status,
          serviceName: ss.service.name,
          amountTotal: a.payment ? Number(a.payment.totalAmount) : 0,
          amountPaid: a.payment ? Number(a.payment.paidAmount) : 0,
          paymentStatus: a.payment?.status ?? null,
        }))
      );

      const contract = s.contracts[0] ?? null;

      return {
        staffId: s.id,
        name: s.user.fullName,
        email: s.user.email,
        type: s.type,
        isActive: s.isActive,
        contract: contract
          ? {
              type: contract.type,
              status: contract.status,
              commissionPercentage: contract.commissionPercentage ?? null,
              fixedRent: contract.fixedRent ? Number(contract.fixedRent) : null,
            }
          : null,
        appointments,
      };
    });

    return { success: true, data };
  } catch (error) {
    console.error("[getStaffPerformance]", error);
    return {
      success: false,
      message: "Impossible de charger les performances du staff.",
      data: [],
    };
  }
}
