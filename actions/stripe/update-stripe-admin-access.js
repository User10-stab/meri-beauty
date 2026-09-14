"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { ROLES } from "@/lib/authorization";

const REVALIDATE_PATH = "/dashboard/payments";

/**
 * Lets a staff member grant/revoke the admin's permission to open and
 * manage their Stripe Express dashboard (via a platform-generated login
 * link — see actions/stripe/admin-stripe-accounts.js).
 *
 * The flag is stored on the Staff row and enforced server-side when the
 * admin requests a login link, so hiding the button in the UI is not the
 * only protection.
 *
 * @param {{ allowAdminAccess: boolean }} input
 */
export async function updateStripeAdminAccess({ allowAdminAccess }) {
  if (typeof allowAdminAccess !== "boolean") {
    return { success: false, message: "Valeur invalide." };
  }

  try {
    const session = await auth();

    if (!session?.user || session.user.role !== ROLES.STAFF) {
      return { success: false, message: "Accès réservé au personnel." };
    }

    const staff = await prisma.staff.findUnique({
      where: { userId: session.user.id },
      select: { id: true },
    });

    if (!staff) {
      return { success: false, message: "Aucun profil staff trouvé." };
    }

    await prisma.staff.update({
      where: { id: staff.id },
      data: { allowAdminStripeAccess: allowAdminAccess },
    });

    revalidatePath(REVALIDATE_PATH);

    return {
      success: true,
      message: allowAdminAccess
        ? "L'administrateur peut désormais voir et gérer votre page de paiement."
        : "L'accès de l'administrateur à votre page de paiement a été révoqué.",
    };
  } catch (error) {
    console.error("[updateStripeAdminAccess]", error);
    return { success: false, message: "Erreur lors de la mise à jour." };
  }
}
