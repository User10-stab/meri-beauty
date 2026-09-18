import { z } from "zod";
import { customerEmailSchema, fullNameSchema } from "@/lib/validations/customer-identity";
import { getVatCountryCode, isValidVatFormat, viesPrefixForCountry } from "@/lib/vat-validation";
import { formBoolean } from "@/lib/validations/boolean";

/**
 * Shared "entreprise account needs a complete billing address" check.
 * Invoicing cannot use an account without one: formatUserAddress() returns
 * null unless line1 + city + postal code are all present, and
 * assertBuyerLegalDataComplete() then refuses the invoice outright. So an
 * entreprise signup must bring the full trio (rue + ville + code postal),
 * while particulier accounts register with identity fields only (B2C sales
 * are ticket-only and never invoiced).
 */
export function refineCompanyAddress(data, ctx) {
  if (!data.isCompany) return;
  if (!data.addressLine1?.trim()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["addressLine1"], message: "L'adresse est obligatoire pour un compte entreprise." });
  }
  if (!data.addressCity?.trim()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["addressCity"], message: "La ville est obligatoire pour un compte entreprise." });
  }
  if (!data.addressPostalCode?.trim()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["addressPostalCode"], message: "Le code postal est obligatoire pour un compte entreprise." });
  }
}
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
  if (!data.companyLegalName) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["companyLegalName"], message: "La raison sociale est obligatoire pour un compte entreprise." });
  }
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

// Exported separately (pre-refinement) so register-client.js can apply the
// same company refinements to the client-side schema — a ZodEffects wrapper
// can't be .extend()-ed directly, so the base object shape has to be the
// thing that's actually shared, not the fully-refined schema.
export const registerFields = z.object({
  fullName: fullNameSchema,
  nickName: z
    .string()
    .trim()
    .min(2, "Le surnom doit comporter au moins 2 caractères.")
    .max(50, "Le surnom ne peut pas dépasser 50 caractères.")
    .optional()
    .or(z.literal("")),
  email: customerEmailSchema,
  phone: z
    .string()
    .trim()
    .min(1, "Le numéro de téléphone est obligatoire.")
    .min(8, "Le numéro de téléphone doit comporter au moins 8 caractères.")
    .max(20, "Le numéro de téléphone ne peut pas dépasser 20 caractères.")
    .regex(
      /^[+]?[\d\s()-]+$/,
      "Le numéro de téléphone ne peut contenir que des chiffres, des espaces et les caractères + ( ) -."
    ),
  password: z
    .string()
    .min(8, "Le mot de passe doit contenir au moins 8 caractères.")
    .max(72, "Le mot de passe ne peut pas dépasser 72 caractères."),
  // Account type — asked directly at signup per the client's requirement,
  // not inferred later. "Entreprise" requires a VAT number so B2B
  // invoicing (lib/invoicing.js) has it from day one instead of chasing it
  // down at first checkout.
  isCompany: formBoolean(false),
  vatNumber: z
    .string()
    .trim()
    .optional()
    .or(z.literal("")),
  // B2B legal identity — required when isCompany (see refineCompanyVat
  // above), stored as a BillingProfile row so lib/invoicing.js#issueInvoice
  // can emit a proper B2B invoice from day one instead of chasing this down
  // at first checkout.
  companyLegalName: z.string().trim().max(150).optional().or(z.literal("")),
  companyRegistrationNo: z.string().trim().max(30).optional().or(z.literal("")),
  companyLegalForm: z.string().trim().max(50).optional().or(z.literal("")),
  billingContactName: z.string().trim().max(100).optional().or(z.literal("")),
  // Billing address — collected only for entreprise accounts (same split as
  // the reservation client-information step: particulier registers with
  // identity fields only). Reservation-created accounts routinely have no
  // address either, so invoicing already handles a missing address; the
  // entreprise form still asks for rue + ville + pays.
  addressLine1: z
    .string()
    .trim()
    .max(150, "L'adresse ne peut pas dépasser 150 caractères.")
    .optional()
    .or(z.literal("")),
  addressLine2: z
    .string()
    .trim()
    .max(150, "L'adresse ne peut pas dépasser 150 caractères.")
    .optional()
    .or(z.literal("")),
  addressCity: z
    .string()
    .trim()
    .max(100, "La ville ne peut pas dépasser 100 caractères.")
    .optional()
    .or(z.literal("")),
  addressPostalCode: z
    .string()
    .trim()
    .max(10, "Le code postal ne peut pas dépasser 10 caractères.")
    .optional()
    .or(z.literal("")),
  addressCountry: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/, "Sélectionnez un pays valide.")
    .default("BE"),
  // A checkbox, not a boolean default — must be explicitly ticked. A refine
  // (not z.literal's error) so the failure lands on the termsAccepted FIELD:
  // the form renders errors.termsAccepted under the checkbox, and a
  // form-level error would never reach it. (Zod 4 also ignores errorMap,
  // which used to leave the raw English "Invalid input: expected true".)
  termsAccepted: z
    .boolean({ error: "Vous devez accepter les conditions générales pour créer un compte." })
    .refine((value) => value === true, {
      message: "Vous devez accepter les conditions générales pour créer un compte.",
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
export const registerSchema = registerFields.superRefine((data, ctx) => {
  refineCompanyVat(data, ctx);
  refineCompanyAddress(data, ctx);
});
