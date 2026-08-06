"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { ROLES } from "@/lib/authorization";

export async function getStaffSettings() {
  try {
    const session = await auth();

    if (!session?.user || session.user.role !== ROLES.STAFF) {
      return { success: false, message: "Accès réservé au personnel.", data: null };
    }

    const staff = await prisma.staff.findUnique({
      where: { userId: session.user.id },
      include: {
        user: {
          select: {
            id: true,
            fullName: true,
            email: true,
            phone: true,
            avatar: true,
          },
        },
        contracts: {
          orderBy: { createdAt: "desc" },
          take: 1,
        },
        workingHours: true,
        timeOffs: {
          orderBy: { startDate: "asc" },
        },
      },
    });

    if (!staff) {
      return { success: false, message: "Profil staff introuvable.", data: null };
    }

    return {
      success: true,
      data: {
        id: staff.id,
        user: staff.user,
        photo: staff.photo,
        bio: staff.bio,
        languages: staff.languages,
        yearsOfExperience: staff.yearsOfExperience,
        reservationConfirmationMode: staff.reservationConfirmationMode,
        depositEnabled: staff.depositEnabled,
        depositPercentage: Number(staff.depositPercentage),
        allowedPaymentMethods: staff.allowedPaymentMethods,
        contract: staff.contracts[0]
          ? {
              id: staff.contracts[0].id,
              type: staff.contracts[0].type,
              commissionPercentage: staff.contracts[0].commissionPercentage
                ? Number(staff.contracts[0].commissionPercentage)
                : null,
              fixedRent: staff.contracts[0].fixedRent
                ? Number(staff.contracts[0].fixedRent)
                : null,
              startDate: staff.contracts[0].startDate.toISOString(),
              endDate: staff.contracts[0].endDate
                ? staff.contracts[0].endDate.toISOString()
                : null,
              status: staff.contracts[0].status,
              notes: staff.contracts[0].notes,
            }
          : null,
        workingHours: staff.workingHours.map((wh) => ({
          id: wh.id,
          day: wh.day,
          startTime: wh.startTime,
          endTime: wh.endTime,
          isClosed: wh.isClosed,
        })),
        timeOffs: staff.timeOffs.map((item) => ({
          id: item.id,
          startDate: item.startDate.toISOString(),
          endDate: item.endDate.toISOString(),
          reason: item.reason,
        })),
      },
    };
  } catch (error) {
    console.error("[getStaffSettings]", error);
    return {
      success: false,
      message: "Impossible de charger vos informations.",
      data: null,
    };
  }
}
