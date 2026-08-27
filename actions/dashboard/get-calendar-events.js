"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { ROLES, isAdminRole, hasDashboardPermission, STAFF_PERMISSIONS } from "@/lib/authorization";
import { getCurrentStaffId } from "@/lib/route-protection";

/**
 * Everything to plot on the dashboard calendar for a given date range:
 * one column per staff member (their appointments) plus a shared "Ateliers &
 * Formations" lane, since Animator (workshop/formation trainers) is a
 * separate, unlinked directory from Staff (appointment-serving employees) —
 * there's no shared identity to overlay them into the same columns.
 *
 * STAFF only ever sees their own column, no ateliers/formations lane (those
 * aren't run by Staff) — same scoping rule as getAllAppointments().
 */
export async function getCalendarEvents({ from, to }) {
  const session = await auth();
  if (!session?.user) return { success: false, message: "Non authentifié.", data: null };
  if (!(await hasDashboardPermission(session.user, STAFF_PERMISSIONS.APPOINTMENTS))) {
    return { success: false, message: "Accès non autorisé.", data: null };
  }

  let staffScopeId = null;
  if (session.user.role === ROLES.STAFF) {
    staffScopeId = await getCurrentStaffId();
    if (!staffScopeId) return { success: false, message: "Profil staff introuvable.", data: null };
  } else if (!isAdminRole(session.user.role)) {
    return { success: false, message: "Accès non autorisé.", data: null };
  }

  const rangeStart = new Date(from);
  const rangeEnd = new Date(to);

  try {
    const [appointments, staffList, workshopSessions, formationSessions] = await Promise.all([
      prisma.appointment.findMany({
        where: {
          isDeleted: false,
          startTime: { lt: rangeEnd },
          endTime: { gt: rangeStart },
          ...(staffScopeId ? { staffService: { staffId: staffScopeId } } : {}),
        },
        select: {
          id: true,
          startTime: true,
          endTime: true,
          status: true,
          user: { select: { fullName: true } },
          staffService: {
            select: { staffId: true, service: { select: { name: true } } },
          },
        },
        orderBy: { startTime: "asc" },
      }),
      staffScopeId
        ? prisma.staff.findMany({
            where: { id: staffScopeId },
            select: { id: true, user: { select: { fullName: true } } },
          })
        : prisma.staff.findMany({
            where: { isDeleted: false, isActive: true },
            select: { id: true, user: { select: { fullName: true } } },
            orderBy: { user: { fullName: "asc" } },
          }),
      staffScopeId
        ? Promise.resolve([])
        : prisma.workshopSession.findMany({
            where: {
              status: { not: "CANCELLED" },
              startDate: { lt: rangeEnd },
              OR: [{ endDate: { gt: rangeStart } }, { endDate: null, startDate: { gte: rangeStart } }],
            },
            select: {
              id: true,
              startDate: true,
              endDate: true,
              capacity: true,
              workshop: { select: { title: true, type: true } },
              animator: { select: { name: true } },
              reservations: { where: { status: { not: "CANCELLED" } }, select: { seatsCount: true } },
            },
            orderBy: { startDate: "asc" },
          }),
      staffScopeId
        ? Promise.resolve([])
        : prisma.formationSession.findMany({
            where: {
              status: { not: "CANCELLED" },
              startDate: { lt: rangeEnd },
              OR: [{ endDate: { gt: rangeStart } }, { endDate: null, startDate: { gte: rangeStart } }],
            },
            select: {
              id: true,
              startDate: true,
              endDate: true,
              capacity: true,
              formation: { select: { title: true, type: true } },
              animator: { select: { name: true } },
              reservations: { where: { status: { not: "CANCELLED" } }, select: { seatsCount: true } },
            },
            orderBy: { startDate: "asc" },
          }),
    ]);

    const appointmentEvents = appointments.map((a) => ({
      id: a.id,
      kind: "appointment",
      staffId: a.staffService.staffId,
      title: a.staffService.service.name,
      subtitle: a.user.fullName,
      start: a.startTime.toISOString(),
      end: a.endTime.toISOString(),
      status: a.status,
    }));

    const workshopEvents = workshopSessions.map((s) => {
      const seatsTaken = s.reservations.reduce((sum, r) => sum + r.seatsCount, 0);
      return {
        id: s.id,
        kind: "atelier",
        title: s.workshop.title,
        subtitle: `${s.workshop.type === "EVENT" ? "Événement" : "Atelier"}${s.animator ? ` · ${s.animator.name}` : ""} · ${seatsTaken}/${s.capacity} places`,
        start: s.startDate.toISOString(),
        end: (s.endDate ?? s.startDate).toISOString(),
        status: null,
      };
    });

    const formationEvents = formationSessions.map((s) => {
      const seatsTaken = s.reservations.reduce((sum, r) => sum + r.seatsCount, 0);
      return {
        id: s.id,
        kind: "formation",
        title: s.formation.title,
        subtitle: `${s.formation.type === "PRIVATE" ? "Formation individuelle" : "Formation groupe"}${s.animator ? ` · ${s.animator.name}` : ""} · ${seatsTaken}/${s.capacity} places`,
        start: s.startDate.toISOString(),
        end: (s.endDate ?? s.startDate).toISOString(),
        status: null,
      };
    });

    return {
      success: true,
      data: {
        staff: staffList.map((s) => ({ id: s.id, name: s.user.fullName })),
        appointments: appointmentEvents,
        activityEvents: [...workshopEvents, ...formationEvents].sort((a, b) => new Date(a.start) - new Date(b.start)),
      },
    };
  } catch (error) {
    console.error("[getCalendarEvents]", error);
    return { success: false, message: "Impossible de charger le calendrier.", data: null };
  }
}
