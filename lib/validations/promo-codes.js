import { z } from "zod";
import { formBoolean } from "@/lib/validations/boolean";
import { parseBrusselsInputValue } from "@/lib/datetime/brussels-input";
import { PROMO_CODE_SCOPES } from "@/lib/promo-code-scopes";
import { PROMO_RULE_KINDS } from "@/lib/promo-rules";

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

const ruleInt = (label, max) =>
  z.preprocess(
    (value) => (value === "" || value == null ? null : value),
    z.coerce.number({ error: `${label} est invalide.` }).int(`${label} doit être un nombre entier.`).min(1, `${label} doit être au moins 1.`).max(max, `${label} ne peut pas dépasser ${max}.`).nullable()
  );

/**
 * One offer of a MULTI_RULE code — see PromoRuleKind in schema.prisma and
 * lib/promo-rules.js. Which numbers are required depends on the mechanic.
 */
const promoRuleSchema = z
  .object({
    label: z.string({ error: "Le libellé de l'offre est obligatoire." }).trim().min(1, "Le libellé de l'offre est obligatoire.").max(120, "Le libellé d'une offre ne peut pas dépasser 120 caractères."),
    kind: z.enum(PROMO_RULE_KINDS, { error: "Le type d'offre est invalide." }),
    percent: z.preprocess(
      (value) => (value === "" || value == null ? null : value),
      z.coerce.number({ error: "Le pourcentage est invalide." }).positive("Le pourcentage doit être supérieur à 0.").max(100, "Un pourcentage ne peut pas dépasser 100.").nullable()
    ),
    minQuantity: ruleInt("La quantité minimum", 999),
    buyQuantity: ruleInt("Le nombre d'articles achetés", 99),
    freeQuantity: ruleInt("Le nombre d'articles offerts", 99),
    samePriceOnly: formBoolean(false),
    brandIds: idList(100, "marques"),
    categoryIds: idList(200, "catégories"),
    subcategoryIds: idList(200, "sous-catégories"),
    productIds: idList(200, "produits"),
  })
  .superRefine((rule, ctx) => {
    const issue = (path, message) => ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
    if (rule.kind !== "BUY_X_GET_Y_FREE" && rule.percent == null) issue("percent", `« ${rule.label} » : indiquez le pourcentage de remise.`);
    if (rule.kind !== "PERCENT_OFF" && rule.buyQuantity == null) issue("buyQuantity", `« ${rule.label} » : indiquez le nombre d'articles achetés.`);
    if (rule.kind === "BUY_X_GET_Y_FREE" && rule.freeQuantity == null) issue("freeQuantity", `« ${rule.label} » : indiquez le nombre d'articles offerts.`);
    if (rule.brandIds.length + rule.categoryIds.length + rule.subcategoryIds.length + rule.productIds.length === 0) {
      issue("brandIds", `« ${rule.label} » : choisissez au moins une marque, une catégorie ou un produit.`);
    }
  })
  // Only the numbers the mechanic reads are kept.
  .transform((rule) => ({
    ...rule,
    percent: rule.kind === "BUY_X_GET_Y_FREE" ? null : rule.percent,
    minQuantity: rule.kind === "PERCENT_OFF" ? rule.minQuantity ?? 1 : 1,
    buyQuantity: rule.kind === "PERCENT_OFF" ? null : rule.buyQuantity,
    freeQuantity: rule.kind === "BUY_X_GET_Y_FREE" ? rule.freeQuantity : null,
    samePriceOnly: rule.kind === "BUY_X_GET_Y_FREE" && rule.samePriceOnly,
  }));

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
  type: z.enum(["PERCENTAGE", "FIXED", "MULTI_RULE"], { error: "Le type de réduction est obligatoire." }),
  // Unused by a MULTI_RULE code (its offers carry their own values).
  value: z.preprocess(
    (value) => (value === "" || value == null ? 0 : value),
    z.coerce.number({ error: "La valeur est invalide." }).nonnegative("La valeur doit être supérieure à 0.")
  ),
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
  rules: z.array(promoRuleSchema, { error: "Offres invalides." }).max(20, "20 offres maximum par code.").optional().default([]),
});

function refinePercentageCap(schema) {
  return schema
    .superRefine((data, ctx) => {
      if (data.type === "MULTI_RULE" && data.rules.length === 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["rules"], message: "Ajoutez au moins une offre à ce code." });
      }
      if (data.type !== "MULTI_RULE" && !(data.value > 0)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["value"], message: "La valeur doit être supérieure à 0." });
      }
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
    }))
    // A multi-offer code prices cart lines: boutique only, and its own
    // offers replace the single value and the product filter.
    .transform((data) =>
      data.type === "MULTI_RULE"
        ? { ...data, value: 0, scopes: ["BOUTIQUE"], productIds: [], serviceIds: [] }
        : { ...data, rules: [] }
    );
}

export const promoCodeSchema = refinePercentageCap(promoCodeFields);

export const updatePromoCodeSchema = refinePercentageCap(
  promoCodeFields.extend({ id: z.string().min(1, "L'identifiant du code est obligatoire.") })
);
