import { z } from "zod";

/**
 * Promo codes are reusable across customers and never auto-expire — only a
 * manual `isActive` toggle retires one (client decision). `value` means
 * different things depending on `type`: percentage points (0-100) or a flat
 * EUR amount, validated accordingly below.
 */
const promoCodeFields = z.object({
  code: z
    .string({ required_error: "Le code est obligatoire." })
    .trim()
    .min(3, "Le code doit contenir au moins 3 caractères.")
    .max(30, "Le code ne peut pas dépasser 30 caractères.")
    .regex(/^[a-zA-Z0-9-]+$/, "Le code ne peut contenir que des lettres, chiffres et tirets.")
    .transform((v) => v.toUpperCase()),
  type: z.enum(["PERCENTAGE", "FIXED"], { required_error: "Le type de réduction est obligatoire." }),
  value: z.coerce
    .number({ invalid_type_error: "La valeur est invalide." })
    .positive("La valeur doit être supérieure à 0."),
  minOrderAmount: z.coerce
    .number({ invalid_type_error: "Le montant minimum est invalide." })
    .nonnegative("Le montant minimum ne peut pas être négatif.")
    .optional()
    .nullable(),
  isActive: z.coerce.boolean().optional().default(true),
});

function refinePercentageCap(schema) {
  return schema.superRefine((data, ctx) => {
    if (data.type === "PERCENTAGE" && data.value > 100) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["value"], message: "Un pourcentage ne peut pas dépasser 100." });
    }
  });
}

export const promoCodeSchema = refinePercentageCap(promoCodeFields);

export const updatePromoCodeSchema = refinePercentageCap(
  promoCodeFields.extend({ id: z.string().min(1, "L'identifiant du code est obligatoire.") })
);
