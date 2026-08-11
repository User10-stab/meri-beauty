"use server";

import { auth } from "@/auth";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { isAdminRole } from "@/lib/authorization";

/**
 * Soft-deletes a customer account — OWNER/ADMIN only. Never a hard delete:
 * the account's appointments/orders/invoices must stay intact for
 * accounting and history. Mirrors the isDeleted convention used everywhere
 * else in this schema (products, staff, appointments, ...).
 */
export async function deleteCustomer(id) {
  const session = await auth();
  if (!session?.user || !isAdminRole(session.user.role)) {
    return { success: false, message: "Accès non autorisé." };
  }

  if (!id) return { success: false, message: "Identifiant manquant." };

  try {
    const existing = await prisma.user.findFirst({
      where: { id, role: "CUSTOMER", isDeleted: false },
      select: { id: true },
    });
    if (!existing) return { success: false, message: "Client introuvable." };

    await prisma.user.update({
      where: { id },
      data: { isDeleted: true, isActive: false, deletedAt: new Date() },
    });

    revalidatePath("/dashboard/customers");
    return { success: true, message: "Client supprimé." };
  } catch (error) {
    console.error("[deleteCustomer]", error);
    return { success: false, message: "Erreur lors de la suppression du client." };
  }
}
