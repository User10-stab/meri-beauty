import { z } from "zod";
import { isValidVatFormat } from "@/lib/vat-validation";
import { DEFAULT_STAFF_PERMISSIONS, STAFF_PERMISSION_VALUES } from "@/lib/authorization";
import { fullNameSchema } from "@/lib/validations/customer-identity";

// ─── Individual field schemas ─────────────────────────────────────────────────

const emailSchema = z
  .string({ error: "L'adresse e-mail est obligatoire." })
  .trim()
  .toLowerCase()
  .email("Veuillez saisir une adresse e-mail valide.");

const phoneSchema = z
  .string({ error: "Le numéro de téléphone est obligatoire." })
  .trim()
  .min(8, "Le numéro de téléphone doit contenir au moins 8 caractères.")
  .max(20, "Le numéro de téléphone ne peut pas dépasser 20 caractères.")
  .regex(
    /^[+]?[\d\s()/-]+$/,
    "Le numéro de téléphone ne peut contenir que des chiffres, espaces et les caractères + ( ) - /."
  );

const bioSchema = z
  .string()
  .trim()
  .optional()
  .nullable();

// Free-text languages — any non-empty string, at least one required
const languagesSchema = z
  .array(
    z
      .string()
      .trim()
      .min(1, "Une langue ne peut pas être vide.")
      .max(50, "Le nom de la langue est trop long.")
  )
  .min(1, "Veuillez ajouter au moins une langue.");

const hireDateSchema = z
  .string()
  .optional()
  .nullable()
  .refine(
    (v) => !v || !isNaN(Date.parse(v)),
    "La date d'embauche n'est pas valide."
  );

const yearsOfExperienceSchema = z.preprocess(
  (v) => (v === "" ? undefined : v),
  z.coerce
    .number({
      error: (issue) =>
        issue.input === undefined
          ? "Les années d'expérience sont obligatoires."
          : "Les années d'expérience doivent être un nombre.",
    })
    .int("Les années d'expérience doivent être un nombre entier.")
    .min(0, "Les années d'expérience ne peuvent pas être négatives.")
    .max(60, "La valeur semble incorrecte (max 60 ans).")
);

// Required, and a real EU number: an independent bills under her own VAT
// number, so a staff profile without one can issue nothing in her own name
// (exactly how Julie Schoemans ended up with sales she couldn't invoice).
// The VIES round-trip lives in the actions (verifyStaffVatNumber) — this is
// the offline shape check.
const vatNumberSchema = z
  .string({ error: "Le numéro de TVA est obligatoire." })
  .trim()
  .min(1, "Le numéro de TVA est obligatoire.")
  .max(50, "Le numéro de TVA ne peut pas dépasser 50 caractères.")
  .refine((value) => isValidVatFormat(value), "Numéro de TVA UE invalide. Ajoutez le préfixe pays (BE, FR, DE, NL…).");

// Optional at creation — an independent without a VAT number yet can be
// onboarded and add it later; she just can't issue her own invoices until
// then (createIndependentStaff/createStaffFromRental skip the VIES check
// entirely when this is blank).
const vatNumberOptionalSchema = z
  .string()
  .trim()
  .max(50, "Le numéro de TVA ne peut pas dépasser 50 caractères.")
  .optional()
  .nullable()
  .or(z.literal(""))
  .refine((value) => !value || isValidVatFormat(value), "Numéro de TVA UE invalide. Ajoutez le préfixe pays (BE, FR, DE, NL…).");

const rythmeSchema = z.preprocess(
  (v) => (v === "" ? undefined : v),
  z
    .enum(["ONE_DAY_PER_WEEK", "TWO_DAYS_PER_WEEK", "THREE_DAYS_PER_WEEK", "FULL_WEEK"], {
      error: (issue) =>
        issue.input === undefined ? undefined : "Rythme invalide.",
    })
    .optional()
    .nullable()
);

// Photo URL is set after upload — optional string (can be relative path like /uploads/staff/...)
const photoUrlSchema = z
  .string()
  .optional()
  .nullable()
  .refine(
    (val) => val === null || val === undefined || val.length > 0,
    "L'URL de la photo ne peut pas être vide"
  );

// Service IDs to assign — optional list
const serviceIdsSchema = z
  .array(z.string().min(1))
  .optional()
  .nullable()
  .default([]);

const dashboardPermissionsSchema = z.preprocess(
  // Drops values that are no longer permissions (POINT_OF_SALE, CASH_REGISTER,
  // ORDERS, SEND_TICKET_EMAIL — deleted 16/09/2026) instead of rejecting the
  // whole form: an account edited before the cleanup migration ran still
  // carries them, and saving its services must not fail over that.
  (value) => (Array.isArray(value) ? value.filter((key) => STAFF_PERMISSION_VALUES.includes(key)) : value),
  z.array(z.enum(STAFF_PERMISSION_VALUES)).default([...DEFAULT_STAFF_PERMISSIONS])
);

// ─── Professional (billing) address — User model columns ─────────────────────
// Same rules as customer registration (lib/validations/register.js): a proper
// staff rental invoice needs the provider's address. addressLine2 is the only
// optional part (apartment/suite — not everyone has one).
const addressLine1Schema = z
  .string({ error: "L'adresse professionnelle est obligatoire." })
  .trim()
  .min(3, "L'adresse professionnelle est obligatoire.")
  .max(150, "L'adresse ne peut pas dépasser 150 caractères.");

const addressLine2Schema = z
  .string()
  .trim()
  .max(150, "L'adresse ne peut pas dépasser 150 caractères.")
  .optional()
  .nullable()
  .or(z.literal(""));

const addressCitySchema = z
  .string({ error: "La ville est obligatoire." })
  .trim()
  .min(2, "La ville est obligatoire.")
  .max(100, "La ville ne peut pas dépasser 100 caractères.");

const addressPostalCodeSchema = z
  .string({ error: "Le code postal est obligatoire." })
  .trim()
  .min(3, "Le code postal est obligatoire.")
  .max(10, "Le code postal ne peut pas dépasser 10 caractères.");

const addressCountrySchema = z
  .string({ error: "Veuillez sélectionner un pays." })
  .trim()
  .min(2, "Le pays est obligatoire.")
  .max(100, "Le nom du pays ne peut pas dépasser 100 caractères.");

// Optional at creation — same fields, no minimum-length ("obligatoire")
// check, so a blank professional address doesn't block onboarding. Staff
// invoicing already tolerates a missing address (lib/staff-invoice.js falls
// back to the VIES-validated address, or omits it entirely).
const addressLine1OptionalSchema = z
  .string()
  .trim()
  .max(150, "L'adresse ne peut pas dépasser 150 caractères.")
  .optional()
  .nullable()
  .or(z.literal(""));

const addressCityOptionalSchema = z
  .string()
  .trim()
  .max(100, "La ville ne peut pas dépasser 100 caractères.")
  .optional()
  .nullable()
  .or(z.literal(""));

const addressPostalCodeOptionalSchema = z
  .string()
  .trim()
  .max(10, "Le code postal ne peut pas dépasser 10 caractères.")
  .optional()
  .nullable()
  .or(z.literal(""));

const addressCountryOptionalSchema = z
  .string()
  .trim()
  .max(100, "Le nom du pays ne peut pas dépasser 100 caractères.")
  .optional()
  .nullable()
  .or(z.literal(""));

// ─── Contract sub-schema (mandatory) ───────────────────────────────────────────
// Contract type is always FIXED_RENT — only the rent amount and dates are needed.

export const contractSchema = z
  .object({
    fixedRent: z.preprocess(
      (v) => (v === "" ? undefined : v),
      z.coerce
        .number({
          error: (issue) =>
            issue.input === undefined
              ? "Le montant du loyer est obligatoire."
              : "Le loyer doit être un nombre.",
        })
        .min(0, "Le loyer ne peut pas être négatif.")
    ),
    startDate: z
      .string({ error: "La date de début du contrat est obligatoire." })
      .refine((v) => !isNaN(Date.parse(v)), "Date de début invalide."),
    endDate: z
      .string()
      .optional()
      .nullable()
      .refine(
        (v) => !v || !isNaN(Date.parse(v)),
        "Date de fin invalide."
      ),
    dueDate: z
      .string()
      .trim()
      .optional()
      .nullable()
      .or(z.literal(""))
      .refine(
        (v) => !v || /^\d+$/.test(v),
        "Le délai doit être un nombre entier de jours."
      )
      .refine(
        (v) => !v || (Number(v) >= 0 && Number(v) <= 365),
        "Le délai doit être entre 0 et 365 jours."
      ),
    notes: z
      .string()
      .trim()
      .optional()
      .nullable(),
  })
  .superRefine((data, ctx) => {
    if (data.endDate && data.startDate && data.endDate <= data.startDate) {
      ctx.addIssue({
        path: ["endDate"],
        code: z.ZodIssueCode.custom,
        message: "La date de fin doit être postérieure à la date de début.",
      });
    }
  });

// ─── Create schema ────────────────────────────────────────────────────────────

export const createIndependentStaffSchema = z.object({
  // User fields
  fullName: fullNameSchema,
  email: emailSchema,
  phone: phoneSchema,
  // Professional (billing) address — optional, stored on the User row. A
  // rental invoice just prints a blank address until it's filled in later.
  addressLine1: addressLine1OptionalSchema,
  addressLine2: addressLine2Schema,
  addressCity: addressCityOptionalSchema,
  addressPostalCode: addressPostalCodeOptionalSchema,
  addressCountry: addressCountryOptionalSchema.default("Belgique"),
  // Staff fields
  photo: photoUrlSchema,
  bio: bioSchema,
  languages: languagesSchema,
  yearsOfExperience: yearsOfExperienceSchema,
  hireDate: hireDateSchema,
  // Optional — see verifyStaffVatNumber callers, which skip the VIES check
  // entirely when this is blank instead of rejecting the form.
  vatNumber: vatNumberOptionalSchema,
  rythme: rythmeSchema,
  // Services to assign
  serviceIds: serviceIdsSchema,
  dashboardPermissions: dashboardPermissionsSchema,
  // Contract is now mandatory — a staff member must always have an associated contract
  contract: contractSchema,
});

// ─── Update schema (full — all editable fields) ───────────────────────────────

const passwordSchema = z.preprocess(
  (v) => (v === "" || v === null ? undefined : v),
  z
    .string()
    .min(8, "Le mot de passe doit contenir au moins 8 caractères.")
    .max(72, "Le mot de passe est trop long.")
    .optional()
);

export const updateIndependentStaffSchema = z.object({
  id: z.string({ error: "Identifiant manquant." }).min(1),

  // ── User fields ───────────────────────────────────────────────────────────
  fullName: fullNameSchema.optional(),
  phone: phoneSchema.optional(),
  // Email change is allowed for admins — the server action resets
  // emailVerified and re-sends a verification email (same rule as the
  // self-service update in actions/staff/update-personal-info.js).
  email: emailSchema.optional(),
  // Empty string means "keep the current password" (handled by preprocess
  // above). When provided, the server action hashes it with bcrypt and
  // bumps sessionVersion so live sessions are invalidated.
  password: passwordSchema,
  // Address stays optional here: the StaffTable active-toggle sends a partial
  // payload without address fields, which must keep validating.
  addressLine1: addressLine1Schema.optional(),
  addressLine2: addressLine2Schema,
  addressCity: addressCitySchema.optional(),
  addressPostalCode: addressPostalCodeSchema.optional(),
  addressCountry: addressCountrySchema.optional(),

  // ── Staff fields ──────────────────────────────────────────────────────────
  photo:             photoUrlSchema,
  bio:               bioSchema,
  languages:         languagesSchema,
  yearsOfExperience: yearsOfExperienceSchema,
  hireDate:          hireDateSchema,
  vatNumber:         vatNumberSchema,
  rythme:            rythmeSchema,
  isActive:          z.boolean().default(true),

  // ── Service assignments (replaces the full set) ───────────────────────────
  serviceIds: serviceIdsSchema,
  dashboardPermissions: dashboardPermissionsSchema.optional(),

  // ── Contract (upsert — always FIXED_RENT) ─────────────────────────────────
  contract: contractSchema.optional().nullable(),
});

// ─── Soft-delete input schema ─────────────────────────────────────────────────

export const softDeleteStaffSchema = z.object({
  id: z.string({ error: "Identifiant manquant." }).min(1),
  reason: z
    .string()
    .trim()
    .optional()
    .nullable(),
});
