import { z } from "zod";

/**
 * Validation schemas for cart / checkout / order fulfilment.
 *
 * Belgium-only: shippingAddress.postalCode is validated as a 4-digit Belgian
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
  email: z
    .string({ required_error: "L'adresse e-mail est obligatoire." })
    .trim()
    .email("Adresse e-mail invalide."),
  phone: z
    .string({ required_error: "Le numéro de téléphone est obligatoire." })
    .trim()
    .min(6, "Le numéro de téléphone est obligatoire."),
  newsletterSubscribed: z.coerce.boolean().optional().default(false),
});

const shippingAddressSchema = z.object({
  line1: z.string().trim().min(3, "L'adresse est obligatoire."),
  line2: z.string().trim().max(150).optional().nullable(),
  city: z.string().trim().min(1, "La ville est obligatoire."),
  postalCode: z
    .string()
    .trim()
    .regex(/^\d{4}$/, "Code postal belge invalide (4 chiffres)."),
});

/**
 * Checkout input. shippingAddress is required only for SHIPPING_PREPAID —
 * the two pickup modes never collect one.
 */
export const checkoutSchema = z
  .object({
    fulfilmentMode: z.enum(["PICKUP_PREPAID", "PICKUP_ON_SITE", "SHIPPING_PREPAID"], {
      required_error: "Le mode de retrait est obligatoire.",
    }),
    customerInfo: customerInfoSchema,
    shippingAddress: shippingAddressSchema.optional().nullable(),
    notes: z.string().trim().max(500).optional().nullable(),
  })
  .superRefine((data, ctx) => {
    if (data.fulfilmentMode === "SHIPPING_PREPAID" && !data.shippingAddress) {
      ctx.addIssue({
        path: ["shippingAddress"],
        code: z.ZodIssueCode.custom,
        message: "L'adresse de livraison est obligatoire pour la livraison à domicile.",
      });
    }
  });

/** For carts over 30kg, where calculateShippingCost has no flat-rate price. */
export const shippingQuoteRequestSchema = z.object({
  fullName: z
    .string({ required_error: "Le nom complet est obligatoire." })
    .trim()
    .min(2, "Le nom complet est obligatoire."),
  email: z
    .string({ required_error: "L'adresse e-mail est obligatoire." })
    .trim()
    .email("Adresse e-mail invalide."),
  phone: z
    .string({ required_error: "Le numéro de téléphone est obligatoire." })
    .trim()
    .min(6, "Le numéro de téléphone est obligatoire."),
  shippingAddress: shippingAddressSchema.optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable(),
});

export const shipOrderSchema = z.object({
  orderId: z.string().min(1, "La commande est obligatoire."),
  bpostTrackingCode: z
    .string({ required_error: "Le numéro de suivi bpost est obligatoire." })
    .trim()
    .min(3, "Le numéro de suivi bpost est obligatoire.")
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
