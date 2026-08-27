"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { hasDashboardPermission, isAdminRole, STAFF_PERMISSIONS } from "@/lib/authorization";

/**
 * Active staff accounts that can be assigned to a formation. The Formation
 * schema still references Animator for public display, but selection is made
 * from real staff accounts only; create-formation resolves the matching
 * Animator profile server-side.
 */
export async function getFormationStaffOptions() {
  const session = await auth();
  if (!session?.user || !(await hasDashboardPermission(session.user, STAFF_PERMISSIONS.FORMATIONS))) {
    return { success: false, data: [], message: "Non autorisé." };
  }

  const staff = await prisma.staff.findMany({
    where: {
      isActive: true,
      isDeleted: false,
      user: {
        role: "STAFF",
        isActive: true,
        isDeleted: false,
        ...(isAdminRole(session.user.role) ? {} : { id: session.user.id }),
      },
    },
    select: {
      photo: true,
      user: { select: { id: true, fullName: true, email: true } },
    },
    orderBy: { user: { fullName: "asc" } },
  });

  const emails = staff.map((member) => member.user.email).filter(Boolean);
  const animatorProfiles = emails.length
    ? await prisma.animator.findMany({ where: { email: { in: emails } }, select: { id: true, email: true } })
    : [];
  const animatorIdByEmail = new Map(animatorProfiles.map((animator) => [animator.email, animator.id]));

  return {
    success: true,
    data: staff.map((member) => ({
      id: member.user.id,
      name: member.user.fullName,
      photo: member.photo,
      animatorId: animatorIdByEmail.get(member.user.email) ?? null,
    })),
  };
}
