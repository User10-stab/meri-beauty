import { z } from "zod";
import { isValidVatFormat, normalizeVatNumber } from "@/lib/vat-validation";

function parseDateOnly(value) {
  if (typeof value !== "string") return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match) {
    const [, year, month, day] = match;
    return new Date(Number(year), Number(month) - 1, Number(day));
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function startOfToday() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function isBeforeToday(value) {
  const date = parseDateOnly(value);
  if (!date) return false;
  date.setHours(0, 0, 0, 0);
  return date < startOfToday();
}

// ─── Individual field schemas ─────────────────────────────────────────────────

const rentalTypeSchema = z
  .string({ error: "Le type de location est obligatoire." })
  .trim()
  .min(1, "Le type de location ne peut pas être vide.")
  .max(100, "Le type de location ne peut pas dépasser 100 caractères.");

const startDateSchema = z
  .string({ error: "La date de début est obligatoire." })
  .refine((v) => parseDateOnly(v) !== null, "Date de début invalide.")
  .refine((v) => !isBeforeToday(v), "La date de début ne peut pas être dans le passé.");

const endDateSchema = z
  .string()
  .refine((v) => !v || !isNaN(Date.parse(v)), "Date de fin invalide.")
  .optional()
  .nullable();

const commissionTypeSchema = z.enum(["PERCENTAGE", "FIXED", "HYBRID"], {
  error: (issue) => (issue.input === undefined ? "Le type de commission est obligatoire." : "Type de commission invalide."),
});

const statusSchema = z.enum(["PENDING", "APPROVED", "REJECTED", "CANCELLED"], {
  error: (issue) => (issue.input === undefined ? "Le statut est obligatoire." : "Statut invalide."),
});

const messageSchema = z
  .string()
  .trim()
  .max(1000, "Le message ne peut pas dépasser 1000 caractères.")
  .optional()
  .nullable();

const specialtySchema = z
  .string({ error: "La spécialité est obligatoire." })
  .trim()
  .min(1, "La spécialité est obligatoire.")
  .max(100, "La spécialité ne peut pas dépasser 100 caractères.");

// Offline format + Belgian checksum. No VIES call here: a live lookup has no
// business inside a Zod schema (VIES is a free EU service with no SLA, and a
// timeout must never read as "invalid"). Format alone already rejects the
// typos and the free-text garbage this field accepted until now.
// `error`, not `required_error`: this project is on Zod 4, where
// required_error / invalid_type_error / errorMap are accepted by the type
// system but silently ignored at runtime — the customer gets Zod's English
// default instead ("Invalid input: expected string, received undefined").
const vatNumberBase = z
  .string({ error: "Le numéro de TVA est obligatoire." })
  .trim()
  .min(1, "Le numéro de TVA est obligatoire.")
  .max(50, "Le numéro de TVA ne peut pas dépasser 50 caractères.")
  .transform(normalizeVatNumber)
  .refine(isValidVatFormat, {
    message:
      "Numéro de TVA invalide. Indiquez le préfixe du pays, par exemple BE0751854027.",
  });

// Creating a request opens a B2B relationship — Marie invoices this person
// rent/commission every month, and a B2B invoice is only valid with a real
// VAT number. The form has always shown a red asterisk on this field; until
// now that was a browser-only `required` attribute, and the schema behind the
// POST endpoint accepted the field missing entirely.
const vatNumberSchema = vatNumberBase;

// Admin-side edits (status, owner response) must not have to resend the VAT
// number — but if one is sent, it goes through exactly the same check.
const optionalVatNumberSchema = vatNumberBase.optional().nullable();

const ownerResponseSchema = z
  .string()
  .trim()
  .max(1000, "La réponse du propriétaire ne peut pas dépasser 1000 caractères.")
  .optional()
  .nullable();

// ─── Create schema ────────────────────────────────────────────────────────────

export const createRentalRequestSchema = z
  .object({
    rentalType: rentalTypeSchema,
    startDate: startDateSchema,
    endDate: endDateSchema,
    commissionType: commissionTypeSchema,
    specialty: specialtySchema,
    vatNumber: vatNumberSchema,
    message: messageSchema,
  })
  .superRefine((data, ctx) => {
    if (
      data.endDate &&
      data.startDate &&
      new Date(data.endDate) <= new Date(data.startDate)
    ) {
      ctx.addIssue({
        path: ["endDate"],
        code: z.ZodIssueCode.custom,
        message: "La date de fin doit être postérieure à la date de début.",
      });
    }
  });

// ─── Update schema ────────────────────────────────────────────────────────────

export const updateRentalRequestSchema = z
  .object({
    id: z.string({ error: "Identifiant manquant." }).min(1),
    rentalType: rentalTypeSchema.optional(),
    startDate: startDateSchema.optional(),
    endDate: endDateSchema.optional(),
    commissionType: commissionTypeSchema.optional(),
    status: statusSchema.optional(),
    specialty: specialtySchema.optional(),
    vatNumber: optionalVatNumberSchema,
    message: messageSchema,
    ownerResponse: ownerResponseSchema,
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

// ─── Status update schema ─────────────────────────────────────────────────────

export const updateRentalRequestStatusSchema = z.object({
  id: z.string({ error: "Identifiant manquant." }).min(1),
  status: statusSchema,
  ownerResponse: ownerResponseSchema,
});
