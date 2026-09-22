import { z } from "zod";
import { customerEmailSchema, fullNameSchema } from "@/lib/validations/customer-identity";
import { termsAcceptedSchema } from "@/lib/terms-consent";
import { formBoolean } from "@/lib/validations/boolean";
import { normalizeVatNumber, isValidVatFormat } from "@/lib/vat-validation";

/**
 * Validation schemas for cart / checkout / order fulfilment.
 *
 * Belgium-only: pickupPoint.postalCode is validated as a 4-digit Belgian
 * postal code, and shipping is only ever offered for SHIPPING_PREPAID.
 */

export const addToCartSchema = z.object({
  variantId: z.string().min(1, "La déclinaison est obligatoire."),
  quantity: z.coerce
    .number({ error: "La quantité est invalide." })
    .int("La quantité doit être un nombre entier.")
    .positive("La quantité doit être supérieure à zéro.")
    .max(99, "Quantité maximale : 99."),
});

export const updateCartItemSchema = z.object({
  cartItemId: z.string().min(1, "L'article est obligatoire."),
  quantity: z.coerce
    .number({ error: "La quantité est invalide." })
    .int("La quantité doit être un nombre entier.")
    .nonnegative("La quantité ne peut pas être négative.")
    .max(99, "Quantité maximale : 99."),
});

const customerInfoSchema = z.object({
  userId: z.string().optional().nullable(),
  // Same rule as everywhere else a name creates/updates a real account (see
  // fullNameSchema's doc comment) — a guest checkout account has to stay
  // bookable later, not just orderable now.
  fullName: fullNameSchema,
  email: customerEmailSchema,
  phone: z
    .string({ error: "Le numéro de téléphone est obligatoire." })
    .trim()
    .min(6, "Le numéro de téléphone est obligatoire."),
  newsletterSubscribed: formBoolean(false),
  // Guest checkout only — the account is created with this password directly
  // (actions/boutique/orders.js's resolveOrCreateCustomer), never generated,
  // never emailed. Length/strength is enforced there (lib/validations/password.js),
  // not here, so a signed-in customer's request (which omits it) still validates.
  password: z.string().max(72).optional().or(z.literal("")),
  // Particulier / Entreprise toggle — decides whether vatNumber below is
  // treated as a real B2B declaration or ignored.
  isCompany: formBoolean(false),
  // Not required here — a returning customer with an address already on
  // file doesn't need to resubmit it. resolveOrCreateCustomer enforces the
  // actual requirement server-side once it knows whether the resolved
  // customer already has one. When present, still format-validated.
  addressLine1: z.string().trim().min(3, "L'adresse de facturation est obligatoire.").max(150).optional().or(z.literal("")),
  addressLine2: z.string().trim().max(150).optional().nullable().or(z.literal("")),
  addressCity: z.string().trim().min(2, "La ville est obligatoire.").max(100).optional().or(z.literal("")),
  addressPostalCode: z.string().trim().min(3, "Le code postal est obligatoire.").max(20).optional().or(z.literal("")),
  addressCountry: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, "Le pays doit être un code ISO à 2 lettres.").optional().or(z.literal("")),
  vatNumber: z
    .string()
    .trim()
    .transform((value) => (value ? normalizeVatNumber(value) : ""))
    .refine((value) => !value || isValidVatFormat(value), "Numéro de TVA UE invalide. Ajoutez le préfixe pays (BE, FR, DE, NL…).")
    .optional()
    .or(z.literal("")),
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

// Mondial Relay itself rejects a recipient phone that isn't in international
// format (e.g. "+322323232232323" — no leading zero after the country code,
// a sane total digit count) — but only discovers this when staff clicks
// "Générer l'étiquette", by which point the order is already paid. Catching
// it at checkout, only for the mode that actually reaches Mondial Relay,
// surfaces the same problem to the customer instead of staff days later.
// Formatting characters (spaces/dots/dashes/parens) are stripped before
// counting digits, so "+32 470 12 34 56" still passes.
function isPlausibleInternationalPhone(phone) {
  if (typeof phone !== "string" || !phone.trim().startsWith("+")) return false;
  const digits = phone.trim().slice(1).replace(/[\s().-]/g, "");
  return /^[1-9]\d{6,13}$/.test(digits);
}

/**
 * Checkout input. pickupPoint is required only for SHIPPING_PREPAID —
 * the two in-salon pickup modes never collect one.
 */
export const checkoutSchema = z
  .object({
    fulfilmentMode: z.enum(["PICKUP_PREPAID", "PICKUP_ON_SITE", "SHIPPING_PREPAID"], {
      error: "Le mode de retrait est obligatoire.",
    }),
    customerInfo: customerInfoSchema,
    pickupPoint: pickupPointSchema.optional().nullable(),
    notes: z.string().trim().optional().nullable(),
    promoCode: z.string().trim().max(30).optional().nullable(),
    termsAccepted: termsAcceptedSchema,
  })
  .superRefine((data, ctx) => {
    if (data.fulfilmentMode === "SHIPPING_PREPAID" && !data.pickupPoint) {
      ctx.addIssue({
        path: ["pickupPoint"],
        code: z.ZodIssueCode.custom,
        message: "Merci de choisir un point relais Mondial Relay.",
      });
    }
    if (data.fulfilmentMode === "SHIPPING_PREPAID" && !isPlausibleInternationalPhone(data.customerInfo.phone)) {
      ctx.addIssue({
        path: ["customerInfo", "phone"],
        code: z.ZodIssueCode.custom,
        message: "Pour une livraison Mondial Relay, le numéro de téléphone doit être au format international, par exemple +32470123456.",
      });
    }
  });

/** For carts over 30kg, where calculateShippingCost has no flat-rate price. */
export const shippingQuoteRequestSchema = z.object({
  fullName: fullNameSchema,
  email: customerEmailSchema,
  phone: z
    .string({ error: "Le numéro de téléphone est obligatoire." })
    .trim()
    .min(6, "Le numéro de téléphone est obligatoire."),
  pickupPoint: pickupPointSchema.optional().nullable(),
  notes: z.string().trim().optional().nullable(),
});

export const shipOrderSchema = z.object({
  orderId: z.string().min(1, "La commande est obligatoire."),
  trackingCode: z
    .string({ error: "Le numéro de suivi est obligatoire." })
    .trim()
    .min(3, "Le numéro de suivi est obligatoire.")
    .max(60, "Le numéro de suivi ne peut pas dépasser 60 caractères."),
});

export const closeShippedOrderSchema = z.object({
  orderId: z.string().min(1, "La commande est obligatoire."),
  collectedAt: z.coerce
    .date({ error: (issue) => (issue.input === undefined ? "La date de retrait au point relais est obligatoire." : "Date invalide.") })
    .refine((d) => d.getTime() <= Date.now() + 60_000, "La date de retrait ne peut pas être dans le futur."),
});

export const cancelOrderSchema = z.object({
  orderId: z.string().min(1, "La commande est obligatoire."),
  reason: z.string().trim().optional().nullable(),
  // Admin-only escape hatch for a SHIPPING_PREPAID order that already has a
  // purchased Mondial Relay label — cancelOrder blocks this by default
  // (the postage cost isn't recoverable through the app), this explicitly
  // acknowledges that loss. See performOrderCancellation's
  // allowLabelledOverride.
  acknowledgeLabelLoss: z.boolean().optional().default(false),
});

// Admin-only close-out for a SHIPPED order whose parcel was never collected
// — see markOrderReturnedUndelivered. `note` is an optional free-text
// addition to the fixed reason (e.g. "Mondial Relay ref. XYZ").
export const markOrderReturnedUndeliveredSchema = z.object({
  orderId: z.string().min(1, "La commande est obligatoire."),
  note: z.string().trim().max(300, "300 caractères maximum.").optional().nullable(),
});

export const submitOrderCancellationRequestSchema = z.object({
  orderId: z.string().min(1, "La commande est obligatoire."),
  reason: z
    .string({ error: "Expliquez brièvement votre demande." })
    .trim()
    .min(10, "Expliquez brièvement votre demande (10 caractères minimum).")
    .max(1000, "Le motif ne peut pas dépasser 1 000 caractères."),
});

export const reviewOrderCancellationRequestSchema = z.object({
  requestId: z.string().min(1, "La demande est obligatoire."),
  decision: z.enum(["APPROVED", "REJECTED"], {
    error: "La décision est invalide.",
  }),
  decisionNote: z.string().trim().max(1000).optional().nullable(),
});

// ─── Returns (Belgian 14-day withdrawal right) ───────────────────────────────

// A free-form string, not a number: the reference is either a ticket number
// (T-2026-000044) or, on a receipt printed before 15/09/2026, an order number.
// lib/tickets/customer-reference.js is what tells the two apart.
export const lookupOrderForReturnSchema = z.object({
  reference: z
    .string({ error: "Le numéro de ticket est obligatoire." })
    .trim()
    .min(1, "Le numéro de ticket est obligatoire."),
  email: z.string({ error: "L'adresse e-mail est obligatoire." }).trim().email("Adresse e-mail invalide."),
});

const RETURN_REASON_CATEGORIES = ["CHANGED_MIND", "DEFECTIVE", "WRONG_ITEM", "DAMAGED_IN_TRANSIT", "NOT_RECEIVED", "GOODWILL"];

export const requestReturnSchema = z.object({
  reference: z.string().trim().min(1, "Le numéro de ticket est obligatoire."),
  email: z.string().trim().email("Adresse e-mail invalide."),
  reasonCategory: z.enum(RETURN_REASON_CATEGORIES, {
    error: (issue) => (issue.input === undefined ? "Merci d'indiquer le motif du retour." : "Motif de retour invalide."),
  }),
  reason: z
    .string({ error: "Merci de préciser le motif du retour." })
    .trim()
    .min(3, "Merci de préciser le motif du retour.")
    .optional()
    .nullable(),
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
  staffNote: z.string().trim().optional().nullable(),
  manualRefundConfirmed: formBoolean(false),
  manualRefundReference: z.string().trim().max(100).optional().nullable(),
});

const RETURN_ITEM_CONDITIONS = ["SEALED_RESELLABLE", "OPENED_HYGIENE", "DAMAGED", "DEFECTIVE", "WRONG_ITEM"];

export const completeReturnRequestSchema = returnActionSchema.extend({
  itemConditions: z
    .array(
      z.object({
        returnRequestItemId: z.string().min(1),
        condition: z.enum(RETURN_ITEM_CONDITIONS, {
          error: "Indiquez l'état de chaque article retourné avant de finaliser.",
        }),
      })
    )
    .min(1, "Indiquez l'état de chaque article retourné avant de finaliser."),
});

// staffNote carries the actual refusal reason sent to the customer (see
// returnRejectedEmail) — required here even though it's optional on the
// shared returnActionSchema used by approve/complete.
export const rejectReturnRequestSchema = returnActionSchema.extend({
  staffNote: z
    .string({ error: "Indiquez le motif du refus — il sera envoyé au client." })
    .trim()
    .min(3, "Indiquez le motif du refus — il sera envoyé au client.")
    .optional()
    .nullable(),
});
