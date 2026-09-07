"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { isAdminRole } from "@/lib/authorization";

/**
 * Per-staff performance snapshot for admin monitoring: appointment and
 * formation counts by status, plus revenue/commission figures, computed from
 * raw per-booking data so the client can re-aggregate for any date range
 * without refetching. Appointments attribute to Staff directly via
 * StaffService. Formations don't — a formation session is assigned an
 * Animator, not a Staff row — so formation revenue is attributed by matching
 * FormationSession.animator.email to Staff.user.email, the same bridge
 * create-formation.js's resolveFormationAnimatorId() maintains and
 * get-formations.js already uses for staff visibility. Workshops/ateliers
 * are intentionally left out: nothing bridges their Animator assignment back
 * to a specific staff email the way formations do.
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

    const staffEmails = staffList.map((s) => s.user.email).filter(Boolean);
    const formationReservations = staffEmails.length
      ? await prisma.formationReservation.findMany({
          where: { session: { animator: { email: { in: staffEmails } } } },
          select: {
            id: true,
            status: true,
            createdAt: true,
            session: {
              select: {
                startDate: true,
                animator: { select: { email: true } },
                formation: { select: { title: true } },
              },
            },
            payment: { select: { status: true, totalAmount: true, paidAmount: true } },
          },
        })
      : [];

    const formationsByEmail = new Map();
    for (const r of formationReservations) {
      const email = r.session.animator?.email;
      if (!email) continue;
      if (!formationsByEmail.has(email)) formationsByEmail.set(email, []);
      formationsByEmail.get(email).push({
        id: r.id,
        date: (r.session.startDate ?? r.createdAt).toISOString(),
        status: r.status,
        serviceName: r.session.formation.title,
        amountTotal: r.payment ? Number(r.payment.totalAmount) : 0,
        amountPaid: r.payment ? Number(r.payment.paidAmount) : 0,
        paymentStatus: r.payment?.status ?? null,
      });
    }

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
        formations: formationsByEmail.get(s.user.email) ?? [],
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
