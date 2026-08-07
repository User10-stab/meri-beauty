"use server";

import { isValidVatFormat, verifyVatWithVies } from "@/lib/vat-validation";

/**
 * Public lookup — checking whether a VAT number is registered is public
 * registry data (VIES itself requires no auth), so this is callable from
 * both the dashboard (Salon's own number) and public reservation forms
 * (a customer's B2B number) without a session.
 *
 * @param {string} vatNumber
 * @returns {Promise<{ success: boolean, valid?: boolean, name?: string, address?: string, message?: string }>}
 */
export async function verifyVatNumber(vatNumber) {
  if (!vatNumber || !vatNumber.trim()) {
    return { success: false, message: "Numéro de TVA manquant." };
  }

  if (!isValidVatFormat(vatNumber)) {
    return { success: true, valid: false, message: "Format de numéro de TVA invalide." };
  }

  return verifyVatWithVies(vatNumber);
}
