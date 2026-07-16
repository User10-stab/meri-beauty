"use server";

import { prisma } from "@/lib/prisma";

/**
 * Returns all users with the CUSTOMER role, serialised for client components.
 *
 * @returns {{ success: boolean, data: Array<{ id, fullName, nickName, email, phone, avatar, isActive, lastLogin, createdAt }>, message?: string }}
 */
export async function getCustomers() {
  try {
    const customers = await prisma.user.findMany({
      where: {
        role: "CUSTOMER",
        isDeleted: false,
      },
      orderBy: [{ fullName: "asc" }],
      select: {
        id: true,
        fullName: true,
        nickName: true,
        email: true,
        phone: true,
        avatar: true,
        isActive: true,
        lastLogin: true,
        createdAt: true,
        _count: {
          select: {
            appointments: true,
          },
        },
      },
    });

    const data = customers.map((c) => ({
      id: c.id,
      fullName: c.fullName,
      nickName: c.nickName ?? null,
      email: c.email,
      phone: c.phone,
      avatar: c.avatar ?? null,
      isActive: c.isActive,
      lastLogin: c.lastLogin?.toISOString() ?? null,
      joinedAt: c.createdAt.toISOString(),
      appointmentsCount: c._count.appointments,
    }));

    return { success: true, data };
  } catch (error) {
    console.error("[getCustomers]", error);
    return {
      success: false,
      data: [],
      message: "Impossible de charger les clients.",
    };
  }
}