import { z } from "zod";

// ─── Individual field schemas ─────────────────────────────────────────────────

const fullNameSchema = z
  .string({ required_error: "Le nom complet est obligatoire." })
  .trim()
  .min(2, "Le nom complet doit contenir au moins 2 caractères.")
  .max(100, "Le nom complet ne peut pas dépasser 100 caractères.");

const emailSchema = z
  .string({ required_error: "L'adresse e-mail est obligatoire." })
  .trim()
  .toLowerCase()
  .email("Veuillez saisir une adresse e-mail valide.");

const phoneSchema = z
  .string({ required_error: "Le numéro de téléphone est obligatoire." })
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
  .max(500, "La biographie ne peut pas dépasser 500 caractères.")
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
      required_error: "Les années d'expérience sont obligatoires.",
      invalid_type_error: "Les années d'expérience doivent être un nombre.",
    })
    .int("Les années d'expérience doivent être un nombre entier.")
    .min(0, "Les années d'expérience ne peuvent pas être négatives.")
    .max(60, "La valeur semble incorrecte (max 60 ans).")
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

// ─── Contract sub-schema (mandatory) ───────────────────────────────────────────
// Contract type is always FIXED_RENT — only the rent amount and dates are needed.

export const contractSchema = z
  .object({
    fixedRent: z.preprocess(
      (v) => (v === "" ? undefined : v),
      z.coerce
        .number({
          required_error: "Le montant du loyer est obligatoire.",
          invalid_type_error: "Le loyer doit être un nombre.",
        })
        .min(0, "Le loyer ne peut pas être négatif.")
    ),
    startDate: z
      .string({ required_error: "La date de début du contrat est obligatoire." })
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
      .max(1000, "Les notes ne peuvent pas dépasser 1000 caractères.")
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
  // Staff fields
  photo: photoUrlSchema,
  bio: bioSchema,
  languages: languagesSchema,
  yearsOfExperience: yearsOfExperienceSchema,
  hireDate: hireDateSchema,
  // Services to assign
  serviceIds: serviceIdsSchema,
  // Contract is now mandatory — a staff member must always have an associated contract
  contract: contractSchema,
});

// ─── Update schema (full — all editable fields) ───────────────────────────────

export const updateIndependentStaffSchema = z.object({
  id: z.string({ required_error: "Identifiant manquant." }).min(1),

  // ── User fields ───────────────────────────────────────────────────────────
  fullName: fullNameSchema.optional(),
  phone: phoneSchema.optional(),
  // email is intentionally excluded — requires a dedicated verification flow

  // ── Staff fields ──────────────────────────────────────────────────────────
  photo:             photoUrlSchema,
  bio:               bioSchema,
  languages:         languagesSchema,
  yearsOfExperience: yearsOfExperienceSchema,
  hireDate:          hireDateSchema,
  isActive:          z.boolean().default(true),

  // ── Service assignments (replaces the full set) ───────────────────────────
  serviceIds: serviceIdsSchema,

  // ── Contract (upsert — always FIXED_RENT) ─────────────────────────────────
  contract: contractSchema.optional().nullable(),
});

// ─── Soft-delete input schema ─────────────────────────────────────────────────

export const softDeleteStaffSchema = z.object({
  id: z.string({ required_error: "Identifiant manquant." }).min(1),
  reason: z
    .string()
    .trim()
    .max(500, "La raison ne peut pas dépasser 500 caractères.")
    .optional()
    .nullable(),
});