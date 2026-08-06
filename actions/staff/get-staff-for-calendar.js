"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { isAdminRole } from "@/lib/authorization";

/**
 * Fetch all active staff members for the calendar staff-filter chips.
 * Admin / Owner only — staff members only see their own calendar.
 *
 * @returns {Promise<{ success: boolean, data?: Array<StaffChip>, message?: string }>}
 */
export async function getStaffForCalendar() {
  try {
    const session = await auth();

    if (!session?.user || !isAdminRole(session.user.role)) {
      // Staff members don't need the list — they only see their own appts
      return { success: true, data: [] };
    }

    const staffList = await prisma.staff.findMany({
      where: {
        isDeleted: false,
        isActive: true,
        user: { isDeleted: false, isActive: true },
      },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        photo: true,
        user: {
          select: { id: true, fullName: true },
        },
      },
    });

    const data = staffList.map((s) => ({
      id: s.id,
      name: s.user?.fullName ?? "—",
      photo: s.photo ?? null,
    }));

    return { success: true, data };
  } catch (error) {
    console.error("[getStaffForCalendar]", error);
    return {
      success: false,
      message: "Impossible de charger la liste du personnel.",
      data: [],
    };
  }
}
