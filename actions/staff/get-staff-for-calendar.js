"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { isAdminRole } from "@/lib/authorization";
import { getCurrentStaffId } from "@/lib/route-protection";

/**
 * Fetch staff members for the calendar.
 *
 * - Admin / Owner: returns ALL active staff with their working hours and time-offs.
 * - Staff: returns only the logged-in staff member with their working hours and time-offs.
 *
 * Working hours are included so the calendar can compute a dynamic timeline
 * based on who is actually working each day.  Time-offs are included so the
 * admin calendar can display absences per staff member.
 *
 * @returns {Promise<{ success: boolean, data?: Array<StaffChip>, message?: string }>}
 */
export async function getStaffForCalendar() {
  try {
    const session = await auth();

    if (!session?.user) {
      return { success: true, data: [] };
    }

    const isAdmin = isAdminRole(session.user.role);

    const staffSelect = {
      id: true,
      photo: true,
      user: {
        select: { id: true, fullName: true },
      },
      workingHours: {
        select: {
          day: true,
          startTime: true,
          endTime: true,
          isClosed: true,
        },
      },
      timeOffs: {
        select: {
          id: true,
          startDate: true,
          endDate: true,
          isFullDay: true,
          reason: true,
        },
      },
    };

    if (isAdmin) {
      const staffList = await prisma.staff.findMany({
        where: {
          isDeleted: false,
          isActive: true,
          user: { isDeleted: false, isActive: true },
        },
        orderBy: { createdAt: "asc" },
        select: staffSelect,
      });

      const data = staffList.map((s) => ({
        id: s.id,
        name: s.user?.fullName ?? "—",
        photo: s.photo ?? null,
        workingHours: s.workingHours ?? [],
        timeOffs: (s.timeOffs ?? []).map((to) => ({
          id: to.id,
          startDate: to.startDate.toISOString(),
          endDate: to.endDate.toISOString(),
          isFullDay: to.isFullDay,
          reason: to.reason,
        })),
      }));

      return { success: true, data };
    }

    // Staff member — return only their own record with working hours and time-offs
    const staffId = await getCurrentStaffId();
    if (!staffId) return { success: true, data: [] };

    const me = await prisma.staff.findUnique({
      where: { id: staffId },
      select: staffSelect,
    });

    if (!me) return { success: true, data: [] };

    return {
      success: true,
      data: [
        {
          id: me.id,
          name: me.user?.fullName ?? "—",
          photo: me.photo ?? null,
          workingHours: me.workingHours ?? [],
          timeOffs: (me.timeOffs ?? []).map((to) => ({
            id: to.id,
            startDate: to.startDate.toISOString(),
            endDate: to.endDate.toISOString(),
            isFullDay: to.isFullDay,
            reason: to.reason,
          })),
        },
      ],
    };
  } catch (error) {
    console.error("[getStaffForCalendar]", error);
    return {
      success: false,
      message: "Impossible de charger la liste du personnel.",
      data: [],
    };
  }
}
