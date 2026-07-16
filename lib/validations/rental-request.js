import { z } from "zod";

// ─── Individual field schemas ─────────────────────────────────────────────────

const rentalTypeSchema = z
  .string({ required_error: "Le type de location est obligatoire." })
  .trim()
  .min(1, "Le type de location ne peut pas être vide.")
  .max(100, "Le type de location ne peut pas dépasser 100 caractères.");

const startDateSchema = z
  .string({ required_error: "La date de début est obligatoire." })
  .refine((v) => !isNaN(Date.parse(v)), "Date de début invalide.");

const endDateSchema = z
  .string()
  .refine((v) => !v || !isNaN(Date.parse(v)), "Date de fin invalide.")
  .optional()
  .nullable();

const commissionTypeSchema = z.enum(["PERCENTAGE", "FIXED", "HYBRID"], {
  required_error: "Le type de commission est obligatoire.",
  invalid_type_error: "Type de commission invalide.",
});

const statusSchema = z.enum(["PENDING", "APPROVED", "REJECTED", "CANCELLED"], {
  required_error: "Le statut est obligatoire.",
  invalid_type_error: "Statut invalide.",
});

const messageSchema = z
  .string()
  .trim()
  .max(1000, "Le message ne peut pas dépasser 1000 caractères.")
  .optional()
  .nullable();

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
    id: z.string({ required_error: "Identifiant manquant." }).min(1),
    rentalType: rentalTypeSchema.optional(),
    startDate: startDateSchema.optional(),
    endDate: endDateSchema.optional(),
    commissionType: commissionTypeSchema.optional(),
    status: statusSchema.optional(),
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
  id: z.string({ required_error: "Identifiant manquant." }).min(1),
  status: statusSchema,
  ownerResponse: ownerResponseSchema,
});