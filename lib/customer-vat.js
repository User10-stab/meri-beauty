import { hasReusableVatValidation } from "@/lib/tax-policy";
import { isValidVatFormat, normalizeVatNumber, verifyVatWithVies } from "@/lib/vat-validation";

/**
 * Validates and persists a customer-submitted VAT number against VIES,
 * shared by every place a customer identity is resolved/created with an
 * optional company VAT number attached (boutique checkout, POS counter
 * sale). Originally lived only in actions/boutique/orders.js — factored out
 * so both call sites validate and save it identically instead of the logic
 * drifting between them.
 *
 * `client` is whichever Prisma client is live at the call site: the plain
 * `prisma` singleton for checkout (runs before its stock-locking
 * transaction), or the active `tx` for POS (the customer is resolved/created
 * inside its own transaction).
 *
 * A blank/absent number is a no-op success — this field is optional, most
 * customers are B2C. An invalid format or a VIES rejection fails the whole
 * sale rather than silently dropping the number, so staff aren't left
 * thinking a bad number was saved.
 *
 * @returns {Promise<{success: boolean, user?: object, message?: string}>}
 */
export async function saveCheckoutVatNumber(client, user, rawVatNumber) {
  const vatNumber = rawVatNumber?.trim() ? normalizeVatNumber(rawVatNumber) : null;
  if (!vatNumber) return { success: true, user };

  if (!isValidVatFormat(vatNumber)) {
    return {
      success: false,
      message: "Numéro de TVA UE invalide. Ajoutez le préfixe pays (BE, FR, DE, NL…).",
    };
  }

  if (hasReusableVatValidation(user, vatNumber)) {
    return { success: true, user };
  }

  const viesResult = await verifyVatWithVies(vatNumber);
  if (!viesResult.success) {
    return {
      success: false,
      message: viesResult.message || "Impossible de vérifier ce numéro de TVA pour le moment. Réessayez.",
    };
  }
  if (!viesResult.valid) {
    return {
      success: false,
      message: "Ce numéro de TVA n'est pas reconnu comme actif par le registre européen VIES.",
    };
  }

  const updated = await client.user.update({
    where: { id: user.id },
    data: {
      isCompany: true,
      vatNumber,
      vatValidatedAt: new Date(),
      vatValidationName: viesResult.name ?? null,
      vatValidationAddress: viesResult.address ?? null,
    },
  });

  return { success: true, user: updated };
}
