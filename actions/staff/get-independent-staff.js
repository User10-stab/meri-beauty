"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { isAdminRole } from "@/lib/authorization";

/**
 * Fetches all independent staff members with their user, contract, and
 * active service assignment data. Returns a plain serialisable array.
 *
 * @returns {{ success: boolean, data?: Array<object>, message?: string }}
 */
export async function getIndependentStaff() {
  try {
    const session = await auth();
    if (!session?.user || !isAdminRole(session.user.role)) {
      return { success: false, data: [], message: "Permissions insuffisantes" };
    }
    const staffList = await prisma.staff.findMany({
      where: { type: "INDEPENDENT", isDeleted: false, user: { isDeleted: false } },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        photo: true,
        bio: true,
        languages: true,
        isActive: true,
        yearsOfExperience: true,
        hireDate: true,
        rythme: true,
        createdAt: true,
        updatedAt: true,
        dashboardPermissions: true,
        stripeAccountId: true,
        stripeAccountType: true,
        stripeChargesEnabled: true,
        stripePayoutsEnabled: true,
        user: {
          select: {
            id: true,
            fullName: true,
            email: true,
            phone: true,
            role: true,
            isActive: true,
            isDeleted: true,
            emailVerified: true,
            createdAt: true,
          },
        },
        contracts: {
          orderBy: { createdAt: "desc" },
          take: 1,
        },
        staffServices: {
          where: { isActive: true },
          select: {
            isActive: true,
            serviceId: true,
            service: {
              select: {
                id: true,
                name: true,
                category: { select: { id: true, name: true } },
              },
            },
          },
        },
        _count: {
          select: { workingHours: true },
        },
      },
    });

    const serialised = staffList.map((s) => ({
      id: s.id,
      photo: s.photo ?? null,
      bio: s.bio,
      languages: s.languages,
      isActive: s.isActive,
      yearsOfExperience: s.yearsOfExperience ?? null,
      hireDate: s.hireDate ? s.hireDate.toISOString() : null,
      rythme: s.rythme ?? null,
      createdAt: s.createdAt.toISOString(),
      updatedAt: s.updatedAt.toISOString(),
      dashboardPermissions: s.dashboardPermissions,
      // Stripe Connect data
      stripeAccountId: s.stripeAccountId,
      stripeAccountType: s.stripeAccountType,
      stripeChargesEnabled: s.stripeChargesEnabled,
      stripePayoutsEnabled: s.stripePayoutsEnabled,
      // Compliance data
      workingHoursCount: s._count.workingHours,
      userIsDeleted: s.user.isDeleted,
      userIsActive: s.user.isActive,
      // Current active service IDs (used to pre-populate the edit form)
      serviceIds: s.staffServices.map((ss) => ss.serviceId),
      // Full service objects (used to render service tags in the table)
      services: s.staffServices.map((ss) => ({
        id: ss.service.id,
        name: ss.service.name,
        category: ss.service.category,
      })),
      // Keep count for convenience
      servicesCount: s.staffServices.length,
      user: {
        ...s.user,
        createdAt: s.user.createdAt.toISOString(),
      },
      contract: s.contracts[0]
        ? {
            id: s.contracts[0].id,
            type: s.contracts[0].type,
            commissionPercentage: s.contracts[0].commissionPercentage
              ? Number(s.contracts[0].commissionPercentage)
              : null,
            fixedRent: s.contracts[0].fixedRent
              ? Number(s.contracts[0].fixedRent)
              : null,
            startDate: s.contracts[0].startDate.toISOString(),
            endDate: s.contracts[0].endDate
              ? s.contracts[0].endDate.toISOString()
              : null,
            status: s.contracts[0].status,
            notes: s.contracts[0].notes,
          }
        : null,
    }));

    return { success: true, data: serialised };
  } catch (error) {
    console.error("[getIndependentStaff]", error);
    return {
      success: false,
      message: "Impossible de charger la liste des auto-entrepreneurs.",
      data: [],
    };
  }
}
