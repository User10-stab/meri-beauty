"use server";

import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { ROLES, isAdminRole } from "@/lib/authorization";
import { getCurrentStaffId } from "@/lib/route-protection";

/**
 * Dashboard appointments list. STAFF only ever sees their own appointments
 * (scoped server-side, same rule as authorizeAppointmentAction in
 * manage-appointment.js) — the staffId filter param only has any effect for
 * OWNER/ADMIN.
 */
export async function getAllAppointments({ status, staffId, search } = {}) {
  const session = await auth();
  if (!session?.user) return { success: false, message: "Non authentifié.", data: [] };

  let staffScopeId = null;
  if (session.user.role === ROLES.STAFF) {
    staffScopeId = await getCurrentStaffId();
    if (!staffScopeId) return { success: false, message: "Profil staff introuvable.", data: [] };
  } else if (!isAdminRole(session.user.role)) {
    return { success: false, message: "Accès non autorisé.", data: [] };
  }

  try {
    const appointments = await prisma.appointment.findMany({
      where: {
        isDeleted: false,
        ...(staffScopeId ? { staffService: { staffId: staffScopeId } } : staffId ? { staffService: { staffId } } : {}),
        ...(status ? { status } : {}),
        ...(search
          ? {
              OR: [
                { user: { fullName: { contains: search, mode: "insensitive" } } },
                { user: { email: { contains: search, mode: "insensitive" } } },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: "desc" },
      include: {
        user: { select: { id: true, fullName: true, email: true, phone: true } },
        cancelledBy: { select: { id: true, fullName: true, role: true } },
        staffService: {
          include: {
            service: { select: { name: true } },
            staff: { select: { id: true, user: { select: { fullName: true } } } },
          },
        },
        payment: { select: { status: true, paymentType: true, totalAmount: true, paidAmount: true, remainingAmount: true } },
        review: { select: { id: true, rating: true, comment: true, createdAt: true } },
      },
    });

    return {
      success: true,
      data: appointments.map((a) => ({
        id: a.id,
        createdAt: a.createdAt,
        date: a.date,
        startTime: a.startTime,
        endTime: a.endTime,
        status: a.status,
        notes: a.notes,
        cancelledAt: a.cancelledAt,
        cancellationReason: a.cancellationReason,
        cancellationSource: a.cancellationSource,
        cancelledBy: a.cancelledBy,
        customer: a.user,
        customerName: a.user?.fullName,
        customerEmail: a.user?.email,
        serviceName: a.staffService.service.name,
        staffId: a.staffService.staff?.id ?? null,
        staffName: a.staffService.staff?.user?.fullName ?? "—",
        payment: a.payment
          ? {
              status: a.payment.status,
              paymentType: a.payment.paymentType,
              totalAmount: Number(a.payment.totalAmount),
              paidAmount: Number(a.payment.paidAmount),
              remainingAmount: Number(a.payment.remainingAmount),
            }
          : null,
        paymentStatus: a.payment?.status,
        paymentType: a.payment?.paymentType,
        totalAmount: a.payment ? Number(a.payment.totalAmount) : null,
        paidAmount: a.payment ? Number(a.payment.paidAmount) : null,
        remainingAmount: a.payment ? Number(a.payment.remainingAmount) : null,
        review: a.review
          ? {
              id: a.review.id,
              rating: a.review.rating,
              comment: a.review.comment,
              createdAt: a.review.createdAt,
            }
          : null,
      })),
    };
  } catch (error) {
    console.error("[getAllAppointments]", error);
    return { success: false, message: "Impossible de charger les rendez-vous.", data: [] };
  }
}

/** Staff list for the admin's filter dropdown — not needed for a STAFF viewer, who has no filter. */
export async function getStaffFilterOptions() {
  const session = await auth();
  if (!session?.user || !isAdminRole(session.user.role)) return { success: false, data: [] };

  try {
    const staff = await prisma.staff.findMany({
      where: { isDeleted: false, isActive: true },
      select: { id: true, user: { select: { fullName: true } } },
      orderBy: { user: { fullName: "asc" } },
    });

    return { success: true, data: staff.map((s) => ({ id: s.id, fullName: s.user.fullName })) };
  } catch (error) {
    console.error("[getStaffFilterOptions]", error);
    return { success: false, data: [] };
  }
}
