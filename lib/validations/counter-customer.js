import { z } from "zod";
import { customerEmailSchema, fullNameSchema } from "@/lib/validations/customer-identity";
import { isValidVatFormat, normalizeVatNumber } from "@/lib/vat-validation";

/**
 * The buyer half of a counter transaction — retail till, walk-in service, or
 * a booking sold on the spot. One schema, shared, because a customer created
 * or completed from any of those screens has to be bookable everywhere else:
 * the fullName rule in particular has to match what the online checkout
 * accepts, or an account created here could end up unable to book online.
 *
 * Previously lived only in lib/validations/point-of-sale.js, private to the
 * retail till. Moved here so actions/counter/walk-in-service.js (and, later,
 * a counter reservation-creation action) can accept the same B2C/B2B shape
 * instead of the narrower ad-hoc {fullName,email,phone} union they had —
 * point-of-sale.js re-exports it so nothing importing from there breaks.
 */
export const counterCustomerSchema = z.object({
  id: z.string().min(1).optional().nullable(),
  // A counter walk-in still creates/updates a real User row (see
  // actions/boutique/point-of-sale.js#serializeCustomer) that the same
  // person can later use to log in and book a workshop/formation — the
  // fullName rule has to match everywhere or an account created here can
  // end up unbookable there.
  fullName: fullNameSchema,
  email: customerEmailSchema,
  phone: z.string().trim().max(20).optional().nullable(),
  // Not required here — a returning customer with an address already on
  // file doesn't need to resubmit it. The calling action enforces the
  // actual requirement server-side once it knows whether the resolved
  // customer already has one. When present, still format-validated.
  addressLine1: z.string().trim().min(3, "L'adresse de facturation est obligatoire.").max(150).optional().or(z.literal("")),
  addressLine2: z.string().trim().max(150).optional().nullable().or(z.literal("")),
  addressCity: z.string().trim().min(2, "La ville est obligatoire.").max(100).optional().or(z.literal("")),
  addressPostalCode: z.string().trim().min(3, "Le code postal est obligatoire.").max(20).optional().or(z.literal("")),
  addressCountry: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, "Le pays doit être un code ISO à 2 lettres.").optional().or(z.literal("")),
  // Optional — most counter customers are B2C. When present, only the
  // format is checked here; the calling action is what actually verifies it
  // against VIES and decides whether it gets saved (see saveCheckoutVatNumber,
  // shared with the online checkout).
  vatNumber: z
    .string()
    .trim()
    .transform((value) => (value ? normalizeVatNumber(value) : ""))
    .refine((value) => !value || isValidVatFormat(value), "Numéro de TVA UE invalide. Ajoutez le préfixe pays (BE, FR, DE, NL…).")
    .optional()
    .or(z.literal("")),
});
