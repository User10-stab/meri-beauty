"use server";

import { auth } from "@/auth";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { isAdminRole } from "@/lib/authorization";
import { z } from "zod";

const updateCustomerSchema = z.object({
  id: z.string().min(1),
  fullName: z.string().trim().min(1, "Le nom est requis.").max(150),
  phone: z.string().trim().min(1, "Le téléphone est requis.").max(30),
  isActive: z.boolean(),
});

/**
 * Edits a customer's own profile fields from the dashboard — OWNER/ADMIN
 * only. STAFF can view customers (they need to during a service) but
 * editing a customer's identity/account-active status is an admin action.
 */
export async function updateCustomer(input) {
  const session = await auth();
  if (!session?.user || !isAdminRole(session.user.role)) {
    return { success: false, message: "Accès non autorisé." };
  }

  const parsed = updateCustomerSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, message: parsed.error.errors[0]?.message ?? "Données invalides." };
  }
  const { id, fullName, phone, isActive } = parsed.data;

  try {
    const existing = await prisma.user.findFirst({
      where: { id, role: "CUSTOMER", isDeleted: false },
      select: { id: true },
    });
    if (!existing) return { success: false, message: "Client introuvable." };

    await prisma.user.update({
      where: { id },
      data: { fullName, phone, isActive },
    });

    revalidatePath("/dashboard/customers");
    return { success: true, message: "Client mis à jour." };
  } catch (error) {
    console.error("[updateCustomer]", error);
    return { success: false, message: "Erreur lors de la mise à jour du client." };
  }
}
