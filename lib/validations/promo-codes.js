import { z } from "zod";
import { formBoolean } from "@/lib/validations/boolean";
import { parseBrusselsInputValue } from "@/lib/datetime/brussels-input";
import { PROMO_CODE_SCOPES } from "@/lib/promo-code-scopes";

const idList = (max, label) =>
  z
    .array(z.string().trim().min(1), { error: `${label} invalide(s).` })
    .max(max, `${max} ${label} maximum.`)
    .optional()
    .default([])
    .transform((ids) => [...new Set(ids)]);

const optionalPositiveInt = (label) =>
  z.preprocess(
    (value) => (value === "" || value == null ? null : value),
    z.coerce
      .number({ error: `${label} est invalide.` })
      .int("La limite doit être un nombre entier.")
      .positive("La limite doit être supérieure à zéro.")
      .nullable()
  );

/**
 * Promo codes are reusable across customers. Expiry and usage cap are both
 * OPTIONAL (left empty = the original "never expires, unlimited uses"
 * behaviour, which stays the default); a manual `isActive` toggle still
 * retires one at any time. `value` means different things depending on
 * `type`: percentage points (0-100) or a flat EUR amount, validated
 * accordingly below.
 */
const promoCodeFields = z.object({
  code: z
    .string({ error: "Le code est obligatoire." })
    .trim()
    .min(3, "Le code doit contenir au moins 3 caractères.")
    .max(30, "Le code ne peut pas dépasser 30 caractères.")
    .regex(/^[a-zA-Z0-9-]+$/, "Le code ne peut contenir que des lettres, chiffres et tirets.")
    .transform((v) => v.toUpperCase()),
  type: z.enum(["PERCENTAGE", "FIXED"], { error: "Le type de réduction est obligatoire." }),
  value: z.coerce
    .number({ error: "La valeur est invalide." })
    .positive("La valeur doit être supérieure à 0."),
  minOrderAmount: z.coerce
    .number({ error: "Le montant minimum est invalide." })
    .nonnegative("Le montant minimum ne peut pas être négatif.")
    .optional()
    .nullable(),
  // A datetime-local value is Brussels wall-clock time, whatever timezone the
  // browser or the server runs in — see lib/datetime/brussels-input.js.
  expiresAt: z.preprocess(
    (value) => (value === "" || value == null ? null : parseBrusselsInputValue(value) ?? value),
    z.coerce.date({ error: "La date d'expiration est invalide." }).nullable()
  ),
  maxUses: optionalPositiveInt("La limite d'utilisations"),
  isActive: formBoolean(true),
  description: z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? null : value),
    z.string().trim().max(500, "La note ne peut pas dépasser 500 caractères.").nullable().optional()
  ),
  // Where the code works — at least one flow. Defaults to everywhere.
  scopes: z
    .array(z.enum(PROMO_CODE_SCOPES), { error: "Choisissez où le code est valable." })
    .min(1, "Choisissez au moins un domaine (boutique, rendez-vous, ateliers, formations).")
    .optional()
    .default(PROMO_CODE_SCOPES)
    .transform((scopes) => [...new Set(scopes)]),
  productIds: idList(200, "produits"),
  serviceIds: idList(200, "prestations"),
  customerIds: idList(50, "clients"),
  maxUsesPerCustomer: optionalPositiveInt("La limite par client"),
});

function refinePercentageCap(schema) {
  return schema
    .superRefine((data, ctx) => {
      if (data.type === "PERCENTAGE" && data.value > 100) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["value"], message: "Un pourcentage ne peut pas dépasser 100." });
      }
      if (data.maxUses != null && data.maxUsesPerCustomer != null && data.maxUsesPerCustomer > data.maxUses) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["maxUsesPerCustomer"],
          message: "La limite par client ne peut pas dépasser la limite totale.",
        });
      }
    })
    // A product/prestation filter only means something inside its own scope —
    // drop it rather than keep a hidden restriction nobody can see.
    .transform((data) => ({
      ...data,
      productIds: data.scopes.includes("BOUTIQUE") ? data.productIds : [],
      serviceIds: data.scopes.includes("APPOINTMENT") ? data.serviceIds : [],
    }));
}

export const promoCodeSchema = refinePercentageCap(promoCodeFields);

export const updatePromoCodeSchema = refinePercentageCap(
  promoCodeFields.extend({ id: z.string().min(1, "L'identifiant du code est obligatoire.") })
);
