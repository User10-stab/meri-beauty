import { z } from "zod";
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

const vatNumberSchema = z
  .string()
  .trim()
  .max(50, "Le numéro de TVA ne peut pas dépasser 50 caractères.")
  .optional()
  .nullable();

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

const dashboardPermissionsSchema = z
  .array(z.enum(STAFF_PERMISSION_VALUES))
  .default([...DEFAULT_STAFF_PERMISSIONS]);

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
  // Professional (billing) address — required, stored on the User row
  addressLine1: addressLine1Schema,
  addressLine2: addressLine2Schema,
  addressCity: addressCitySchema,
  addressPostalCode: addressPostalCodeSchema,
  addressCountry: addressCountrySchema.default("Belgique"),
  // Staff fields
  photo: photoUrlSchema,
  bio: bioSchema,
  languages: languagesSchema,
  yearsOfExperience: yearsOfExperienceSchema,
  hireDate: hireDateSchema,
  vatNumber: vatNumberSchema,
  rythme: rythmeSchema,
  // Services to assign
  serviceIds: serviceIdsSchema,
  dashboardPermissions: dashboardPermissionsSchema,
  // Contract is now mandatory — a staff member must always have an associated contract
  contract: contractSchema,
});

// ─── Update schema (full — all editable fields) ───────────────────────────────

export const updateIndependentStaffSchema = z.object({
  id: z.string({ error: "Identifiant manquant." }).min(1),

  // ── User fields ───────────────────────────────────────────────────────────
  fullName: fullNameSchema.optional(),
  phone: phoneSchema.optional(),
  // email is intentionally excluded — requires a dedicated verification flow
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
