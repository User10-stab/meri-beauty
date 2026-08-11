import { z } from "zod";
import { customerEmailSchema } from "@/lib/validations/customer-identity";
import { getVatCountryCode, isValidVatFormat, viesPrefixForCountry } from "@/lib/vat-validation";

/**
 * Shared "entreprise account needs a valid-format VAT number" check — a
 * plain function (not baked into a schema) so both registerSchema below and
 * registerClientSchema (lib/validations/register-client.js) can run the
 * exact same rule via their own .superRefine() without duplicating the
 * logic itself. Only checks format here (instant, offline); the live VIES
 * lookup happens server-side in registerUser, same as every other VAT entry
 * point in this app (e.g. createWorkshopReservation).
 */
export function refineCompanyVat(data, ctx) {
  if (!data.isCompany) return;
  if (!data.vatNumber) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["vatNumber"], message: "Le numéro de TVA est obligatoire pour un compte entreprise." });
    return;
  }
  const expectedPrefix = viesPrefixForCountry(data.addressCountry);
  if (!expectedPrefix) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["vatNumber"],
      message: "VIES vérifie uniquement les entreprises de l’UE. Pour une société hors UE, contactez Meri Beauty afin d’enregistrer l’identifiant fiscal approprié.",
    });
    return;
  }
  if (!isValidVatFormat(data.vatNumber)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["vatNumber"], message: "Numéro de TVA UE invalide. Ajoutez le préfixe pays, par exemple BE, FR, DE ou NL." });
    return;
  }
  if (getVatCountryCode(data.vatNumber) !== expectedPrefix) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["vatNumber"],
      message: `Le numéro de TVA doit correspondre au pays de facturation (${expectedPrefix}).`,
    });
  }
}

// Exported separately (pre-refinement) so register-client.js can .extend()
// it with confirmPassword — Zod's superRefine wrapper (ZodEffects) can't be
// .extend()-ed directly, so the base object shape has to be the thing
// that's actually shared, not the fully-refined schema.
export const registerFields = z.object({
  fullName: z
    .string()
    .trim()
    .min(2, "Full name must be at least 2 characters.")
    .max(100, "Full name must be at most 100 characters."),
  nickName: z
    .string()
    .trim()
    .min(2, "Nickname must be at least 2 characters.")
    .max(50, "Nickname must be at most 50 characters.")
    .optional()
    .or(z.literal("")),
  email: customerEmailSchema,
  phone: z
    .string()
    .trim()
    .min(8, "Phone number must be at least 8 characters.")
    .max(20, "Phone number must be at most 20 characters.")
    .regex(
      /^[+]?[\d\s()-]+$/,
      "Phone number can only contain digits, spaces, and + ( ) - characters."
    ),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters.")
    .max(72, "Password must be at most 72 characters."),
  // Account type — asked directly at signup per the client's requirement,
  // not inferred later. "Entreprise" requires a VAT number so B2B
  // invoicing (lib/invoicing.js) has it from day one instead of chasing it
  // down at first checkout.
  isCompany: z.coerce.boolean().optional().default(false),
  vatNumber: z
    .string()
    .trim()
    .optional()
    .or(z.literal("")),
  // Billing address — mandatory for every account, particulier or
  // entreprise: a proper invoice needs the customer's address regardless of
  // account type (a VAT number alone doesn't cover that). addressLine2 is
  // the only optional part (apartment/suite — not everyone has one).
  addressLine1: z
    .string()
    .trim()
    .min(3, "L'adresse est obligatoire.")
    .max(150, "L'adresse ne peut pas dépasser 150 caractères."),
  addressLine2: z
    .string()
    .trim()
    .max(150, "L'adresse ne peut pas dépasser 150 caractères.")
    .optional()
    .or(z.literal("")),
  addressCity: z
    .string()
    .trim()
    .min(2, "La ville est obligatoire.")
    .max(100, "La ville ne peut pas dépasser 100 caractères."),
  addressPostalCode: z
    .string()
    .trim()
    .min(3, "Le code postal est obligatoire.")
    .max(10, "Le code postal ne peut pas dépasser 10 caractères."),
  addressCountry: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/, "Sélectionnez un pays valide.")
    .default("BE"),
  // A checkbox, not a boolean default — must be explicitly ticked. Zod's
  // z.literal(true) rejects `false` AND `undefined`, so an unchecked box
  // fails validation with a clear message instead of silently defaulting.
  termsAccepted: z.literal(true, {
    errorMap: () => ({ message: "Vous devez accepter les conditions générales pour créer un compte." }),
  }),
  newsletterSubscribed: z.boolean().optional().default(false),
});

/**
 * Canonical registration schema — the one registerUser (the server action
 * that actually writes the User row) validates against. register-client.js
 * extends registerFields (above) rather than redefining the same fields a
 * second time, so the client-side form validation and the server-side write
 * can't quietly drift (e.g. a field silently dropped from one but not the
 * other — nickName used to be exactly this bug: present in the old
 * client-only schema, absent from this one, silently stripped on every
 * signup regardless of what the customer typed).
 */
export const registerSchema = registerFields.superRefine(refineCompanyVat);
