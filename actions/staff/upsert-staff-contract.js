"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { isAdminRole } from "@/lib/authorization";
import { staffContractSchema } from "@/lib/validations/staff-settings";

const REVALIDATE_PATH = "/dashboard/account-settings";

// Rent/fee terms are set by the salon, not chosen by the staff member they
// apply to — this was previously gated on `role === STAFF` and resolved
// staffId from the caller's own session, which would have let any staff
// member set their own rent the moment this action got wired to a form.
// ADMIN/OWNER only, acting on an explicitly passed staffId.
export async function upsertStaffContract(staffId, input) {
  if (!staffId) {
    return { success: false, message: "Membre du personnel manquant." };
  }

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

    if (!session?.user || !isAdminRole(session.user.role)) {
      return { success: false, message: "Permissions insuffisantes" };
    }

    const staff = await prisma.staff.findUnique({
      where: { id: staffId },
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
