import { registerFields, refineCompanyVat, refineCompanyAddress } from "@/lib/validations/register";

/**
 * Client-side form schema — the canonical registerFields plus the same
 * company rules registerSchema applies server-side (VAT + entreprise
 * billing address), so the client-side form validation and the
 * server-side write can't quietly drift. (The old confirmPassword
 * extension lived here when the form had a confirmation field; the form
 * now asks for the password once, like the reservation
 * client-information step.)
 */
export const registerClientSchema = registerFields.superRefine((data, ctx) => {
  refineCompanyVat(data, ctx);
  refineCompanyAddress(data, ctx);
});
