"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { ROLES } from "@/lib/authorization";

/**
 * Updates the staff member's allowed payment methods preference.
 * 
 * @param {{ allowedPaymentMethods: "BOTH" | "ONLINE_ONLY" | "CASH_ONLY" }} data
 */
export async function updatePaymentSettings({ allowedPaymentMethods }) {
  const validValues = ["BOTH", "ONLINE_ONLY", "CASH_ONLY"];
  if (!validValues.includes(allowedPaymentMethods)) {
    return { success: false, message: "Valeur invalide pour les méthodes de paiement." };
  }

  try {
    const session = await auth();

    if (!session?.user || session.user.role !== ROLES.STAFF) {
      return { success: false, message: "Accès réservé au personnel." };
    }

    // If switching to CASH_ONLY, force-disable deposits server-side.
    await prisma.staff.update({
      where: { userId: session.user.id },
      data: {
        allowedPaymentMethods,
        ...(allowedPaymentMethods === "CASH_ONLY"
          ? { depositEnabled: false, depositPercentage: 0 }
          : {}),
      },
    });

    return { success: true, message: "Paramètres de paiement mis à jour." };
  } catch (error) {
    console.error("[updatePaymentSettings]", error);
    return { success: false, message: "Erreur lors de la mise à jour." };
  }
}