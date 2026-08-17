"use server";

import { auth } from "@/auth";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { isAdminRole } from "@/lib/authorization";
import { isValidVatFormat } from "@/lib/vat-validation";
import { writeAuditLog, AUDIT_ACTIONS } from "@/lib/audit-log";

/**
 * Admin override: manually accept a customer's B2B VAT number even when
 * VIES rejected it or was unreachable. Client decision (Marie, form
 * response 10 Aug 2026): the customer self-service flow
 * (updateMyVatNumber, actions/customer/settings.js) hard-blocks on a live
 * VIES confirmation with no way through for a customer whose number is
 * genuinely active but VIES is slow/down or the registration is too recent
 * to show up yet — staff need a way to unblock that from the dashboard.
 *
 * Format/checksum is still enforced (isValidVatFormat) — only the live VIES
 * lookup is skipped. Every use is written to the audit log since it's a
 * deliberate bypass of the normal verification step, not routine editing.
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

  const trimmed = vatNumber?.trim() || null;
  if (trimmed && !isValidVatFormat(trimmed)) {
    return { success: false, message: "Numéro de TVA UE invalide. Ajoutez le préfixe pays (BE, FR, DE, NL…)." };
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
          vatNumber: trimmed,
          // Manual overrides are never sufficient for an automatic 0% sale.
          vatValidatedAt: null,
          vatValidationName: null,
          vatValidationAddress: null,
        },
      });

      await writeAuditLog(tx, {
        action: AUDIT_ACTIONS.CUSTOMER_VAT_NUMBER_OVERRIDDEN,
        entityType: "User",
        entityId: customerId,
        before: { vatNumber: existing.vatNumber },
        after: { vatNumber: trimmed },
        metadata: { verificationSource: "MANUAL_STAFF_OVERRIDE" },
        actor: session.user,
      });
    });

    revalidatePath("/dashboard/customers");
    return {
      success: true,
      message: trimmed
        ? "Numéro de TVA enregistré manuellement (vérification VIES contournée)."
        : "Numéro de TVA supprimé.",
    };
  } catch (error) {
    console.error("[setCustomerVatNumberManually]", error);
    return { success: false, message: "Une erreur est survenue." };
  }
}
