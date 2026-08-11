import { z } from "zod";
import { customerEmailSchema } from "@/lib/validations/customer-identity";

/**
 * Validation schemas for cart / checkout / order fulfilment.
 *
 * Belgium-only: pickupPoint.postalCode is validated as a 4-digit Belgian
 * postal code, and shipping is only ever offered for SHIPPING_PREPAID.
 */

export const addToCartSchema = z.object({
  variantId: z.string().min(1, "La déclinaison est obligatoire."),
  quantity: z.coerce
    .number({ invalid_type_error: "La quantité est invalide." })
    .int("La quantité doit être un nombre entier.")
    .positive("La quantité doit être supérieure à zéro.")
    .max(99, "Quantité maximale : 99."),
});

export const updateCartItemSchema = z.object({
  cartItemId: z.string().min(1, "L'article est obligatoire."),
  quantity: z.coerce
    .number({ invalid_type_error: "La quantité est invalide." })
    .int("La quantité doit être un nombre entier.")
    .nonnegative("La quantité ne peut pas être négative.")
    .max(99, "Quantité maximale : 99."),
});

const customerInfoSchema = z.object({
  userId: z.string().optional().nullable(),
  fullName: z
    .string({ required_error: "Le nom complet est obligatoire." })
    .trim()
    .min(2, "Le nom complet est obligatoire."),
  email: customerEmailSchema,
  phone: z
    .string({ required_error: "Le numéro de téléphone est obligatoire." })
    .trim()
    .min(6, "Le numéro de téléphone est obligatoire."),
  newsletterSubscribed: z.coerce.boolean().optional().default(false),
});

/**
 * A Mondial Relay pickup point. `id` is the real "Num" from Mondial Relay's
 * point database when chosen through the widget — null when chosen through
 * the manual fallback form (no NEXT_PUBLIC_MONDIAL_RELAY_BRAND_ID configured
 * yet), which is why it's optional while the other fields never are.
 */
const pickupPointSchema = z.object({
  id: z.string().trim().max(20).optional().nullable(),
  name: z.string().trim().min(1, "Le point relais est obligatoire."),
  address: z.string().trim().min(3, "L'adresse du point relais est obligatoire."),
  postalCode: z
    .string()
    .trim()
    .regex(/^\d{4}$/, "Code postal belge invalide (4 chiffres)."),
  city: z.string().trim().min(1, "La ville est obligatoire."),
  countryCode: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/).optional().default("BE"),
});

/**
 * Checkout input. pickupPoint is required only for SHIPPING_PREPAID —
 * the two in-salon pickup modes never collect one.
 */
export const checkoutSchema = z
  .object({
    fulfilmentMode: z.enum(["PICKUP_PREPAID", "PICKUP_ON_SITE", "SHIPPING_PREPAID"], {
      required_error: "Le mode de retrait est obligatoire.",
    }),
    customerInfo: customerInfoSchema,
    pickupPoint: pickupPointSchema.optional().nullable(),
    notes: z.string().trim().max(500).optional().nullable(),
    promoCode: z.string().trim().max(30).optional().nullable(),
  })
  .superRefine((data, ctx) => {
    if (data.fulfilmentMode === "SHIPPING_PREPAID" && !data.pickupPoint) {
      ctx.addIssue({
        path: ["pickupPoint"],
        code: z.ZodIssueCode.custom,
        message: "Merci de choisir un point relais Mondial Relay.",
      });
    }
  });

/** For carts over 30kg, where calculateShippingCost has no flat-rate price. */
export const shippingQuoteRequestSchema = z.object({
  fullName: z
    .string({ required_error: "Le nom complet est obligatoire." })
    .trim()
    .min(2, "Le nom complet est obligatoire."),
  email: customerEmailSchema,
  phone: z
    .string({ required_error: "Le numéro de téléphone est obligatoire." })
    .trim()
    .min(6, "Le numéro de téléphone est obligatoire."),
  pickupPoint: pickupPointSchema.optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable(),
});

export const shipOrderSchema = z.object({
  orderId: z.string().min(1, "La commande est obligatoire."),
  trackingCode: z
    .string({ required_error: "Le numéro de suivi est obligatoire." })
    .trim()
    .min(3, "Le numéro de suivi est obligatoire.")
    .max(60, "Le numéro de suivi ne peut pas dépasser 60 caractères."),
});

export const cancelOrderSchema = z.object({
  orderId: z.string().min(1, "La commande est obligatoire."),
  reason: z.string().trim().max(255).optional().nullable(),
});

// ─── Returns (Belgian 14-day withdrawal right) ───────────────────────────────

export const lookupOrderForReturnSchema = z.object({
  orderNumber: z.coerce.number({ required_error: "Le numéro de commande est obligatoire." }).int().positive(),
  email: z.string({ required_error: "L'adresse e-mail est obligatoire." }).trim().email("Adresse e-mail invalide."),
});

export const requestReturnSchema = z.object({
  orderNumber: z.coerce.number().int().positive(),
  email: z.string().trim().email("Adresse e-mail invalide."),
  reason: z
    .string({ required_error: "Merci d'indiquer le motif du retour." })
    .trim()
    .min(3, "Merci d'indiquer le motif du retour.")
    .max(500),
  items: z
    .array(
      z.object({
        orderItemId: z.string().min(1),
        quantity: z.coerce.number().int().positive(),
      })
    )
    .min(1, "Sélectionnez au moins un article à retourner."),
});

export const returnActionSchema = z.object({
  returnRequestId: z.string().min(1, "La demande de retour est obligatoire."),
  staffNote: z.string().trim().max(500).optional().nullable(),
});
