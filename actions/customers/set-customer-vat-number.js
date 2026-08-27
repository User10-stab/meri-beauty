"use server";

import { auth } from "@/auth";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { isAdminRole } from "@/lib/authorization";
import { isValidVatFormat, normalizeVatNumber, verifyVatWithVies } from "@/lib/vat-validation";
import { writeAuditLog, AUDIT_ACTIONS } from "@/lib/audit-log";

/**
 * Admin customer VAT editing follows the same VIES gate as self-service.
 * A number is never marked as validated from format alone.
 *
 * @param {string} customerId
 * @param {string} vatNumber - pass "" to clear a previously saved number.
 */
export async function setCustomerVatNumberManually(customerId, vatNumber) {
  const session = await auth();
  if (!session?.user || !isAdminRole(session.user.role)) {
    return { success: false, message: "Accès non autorisé." };
  }

  if (!customerId) {
    return { success: false, message: "Client manquant." };
  }

  const trimmed = vatNumber?.trim() ? normalizeVatNumber(vatNumber) : null;
  if (trimmed && !isValidVatFormat(trimmed)) {
    return { success: false, message: "Numéro de TVA UE invalide. Ajoutez le préfixe pays (BE, FR, DE, NL…)." };
  }

  let viesResult = null;
  if (trimmed) {
    viesResult = await verifyVatWithVies(trimmed);
    if (!viesResult.success) {
      return { success: false, message: viesResult.message || "Impossible de vérifier ce numéro auprès de VIES. Réessayez." };
    }
    if (!viesResult.valid) {
      return { success: false, message: "Ce numéro de TVA n'est pas reconnu comme actif par le registre européen VIES." };
    }
  }

  try {
    const existing = await prisma.user.findFirst({
      where: { id: customerId, role: "CUSTOMER", isDeleted: false },
      select: { id: true, vatNumber: true },
    });
    if (!existing) return { success: false, message: "Client introuvable." };

    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: customerId },
        data: {
          isCompany: trimmed ? true : undefined,
          vatNumber: trimmed,
          vatValidatedAt: trimmed ? new Date() : null,
          vatValidationName: viesResult?.name ?? null,
          vatValidationAddress: viesResult?.address ?? null,
        },
      });

      await writeAuditLog(tx, {
        action: AUDIT_ACTIONS.CUSTOMER_VAT_NUMBER_OVERRIDDEN,
        entityType: "User",
        entityId: customerId,
        before: { vatNumber: existing.vatNumber },
        after: { vatNumber: trimmed },
        metadata: { verificationSource: trimmed ? "VIES" : "CLEARED" },
        actor: session.user,
      });
    });

    revalidatePath("/dashboard/customers");
    return {
      success: true,
      message: trimmed
        ? "Numéro de TVA vérifié auprès de VIES et enregistré."
        : "Numéro de TVA supprimé.",
    };
  } catch (error) {
    console.error("[setCustomerVatNumberManually]", error);
    return { success: false, message: "Une erreur est survenue." };
  }
}
