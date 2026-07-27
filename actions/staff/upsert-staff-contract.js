"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { ROLES } from "@/lib/authorization";
import { staffContractSchema } from "@/lib/validations/staff-settings";

const REVALIDATE_PATH = "/dashboard/account-settings";

export async function upsertStaffContract(input) {
  const parsed = staffContractSchema.safeParse(input);

  if (!parsed.success) {
    const fe = parsed.error.flatten().fieldErrors;
    return {
      success: false,
      message: "Veuillez corriger les erreurs.",
      errors: {
        fixedRent: fe.fixedRent?.[0] ?? null,
        startDate: fe.startDate?.[0] ?? null,
        endDate: fe.endDate?.[0] ?? null,
        notes: fe.notes?.[0] ?? null,
      },
    };
  }

  try {
    const session = await auth();

    if (!session?.user || session.user.role !== ROLES.STAFF) {
      return { success: false, message: "Permissions insuffisantes" };
    }

    const staff = await prisma.staff.findUnique({
      where: { userId: session.user.id },
      select: { id: true },
    });

    if (!staff) {
      return { success: false, message: "Profil staff introuvable." };
    }

    const { fixedRent, startDate, endDate, notes } = parsed.data;

    // Find existing active contract
    const existingContract = await prisma.contract.findFirst({
      where: { staffId: staff.id, status: "ACTIVE" },
      select: { id: true },
    });

    if (existingContract) {
      await prisma.contract.update({
        where: { id: existingContract.id },
        data: {
          fixedRent,
          startDate: new Date(startDate),
          endDate: endDate ? new Date(endDate) : null,
          notes: notes ?? null,
        },
      });
    } else {
      await prisma.contract.create({
        data: {
          staffId: staff.id,
          type: "FIXED_RENT",
          fixedRent,
          startDate: new Date(startDate),
          endDate: endDate ? new Date(endDate) : null,
          notes: notes ?? null,
          status: "ACTIVE",
        },
      });
    }

    revalidatePath(REVALIDATE_PATH);

    return { success: true, message: "Contrat enregistré avec succès." };
  } catch (error) {
    console.error("[upsertStaffContract]", error);
    return { success: false, message: "Une erreur est survenue." };
  }
}
