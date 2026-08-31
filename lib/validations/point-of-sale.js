import { z } from "zod";
import { customerEmailSchema, fullNameSchema } from "@/lib/validations/customer-identity";
import { isValidVatFormat, normalizeVatNumber } from "@/lib/vat-validation";

const customerSchema = z.object({
  id: z.string().min(1).optional().nullable(),
  // A POS walk-in still creates/updates a real User row (see
  // point-of-sale.js#serializeCustomer) that the same person can later use to
  // log in and book a workshop/formation — the fullName rule has to match
  // everywhere or an account created here can end up unbookable there.
  fullName: fullNameSchema,
  email: customerEmailSchema,
  phone: z.string().trim().max(20).optional().nullable(),
  // Not required here — a returning customer with an address already on
  // file doesn't need to resubmit it. completePointOfSaleSale enforces the
  // actual requirement server-side once it knows whether the resolved
  // customer already has one. When present, still format-validated.
  addressLine1: z.string().trim().min(3, "L'adresse de facturation est obligatoire.").max(150).optional().or(z.literal("")),
  addressLine2: z.string().trim().max(150).optional().nullable().or(z.literal("")),
  addressCity: z.string().trim().min(2, "La ville est obligatoire.").max(100).optional().or(z.literal("")),
  addressPostalCode: z.string().trim().min(3, "Le code postal est obligatoire.").max(20).optional().or(z.literal("")),
  addressCountry: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, "Le pays doit être un code ISO à 2 lettres.").optional().or(z.literal("")),
  // Optional — most counter customers are B2C. When present, only the
  // format is checked here; completePointOfSaleSale is what actually
  // verifies it against VIES and decides whether it gets saved (see
  // saveCheckoutVatNumber, shared with the online checkout).
  vatNumber: z
    .string()
    .trim()
    .transform((value) => (value ? normalizeVatNumber(value) : ""))
    .refine((value) => !value || isValidVatFormat(value), "Numéro de TVA UE invalide. Ajoutez le préfixe pays (BE, FR, DE, NL…).")
    .optional()
    .or(z.literal("")),
});

// A "client de passage" gives no name, so this can never become a real
// Invoice (customerName/customerEmail are non-null there) — only whether the
// existing ticket PDF is also emailed. Optional, hence the blank-string
// escape hatch: most walk-ins still take a printed ticket and nothing else.
const walkInEmailSchema = z.union([customerEmailSchema, z.literal("")]).optional().transform((value) => value || "");

const productLineSchema = z.object({
  type: z.literal("PRODUCT"),
  variantId: z.string().min(1),
  quantity: z.coerce.number().int().positive().max(99),
});

// An ad-hoc counter sale of a service (haircut, etc.) — not tied to any
// Service/StaffService catalog entry, since a walk-in service isn't always
// pre-booked. issueInvoice already accepts source-agnostic description+price
// lines (see buildServiceInvoiceLines), so this needs no catalog lookup.
const serviceLineSchema = z.object({
  type: z.literal("SERVICE"),
  description: z.string().trim().min(2, "La description de la prestation est obligatoire.").optional(),
  unitPrice: z.coerce.number().positive().max(100000),
  quantity: z.coerce.number().int().positive().max(99),
});

export const pointOfSaleSaleSchema = z
  .object({
    // Null means an anonymous "client de passage" sale — no account is
    // created, a simplified ticket is issued instead of a nominative
    // invoice. Restricted to CASH/EXTERNAL_TERMINAL below: a QR/Stripe
    // checkout has nowhere to send `customer_email` without a real one.
    customer: customerSchema.nullable(),
    // Only meaningful when customer is null — ignored otherwise, since a
    // named customer already gets their invoice by e-mail regardless.
    walkInEmail: walkInEmailSchema,
    // Only meaningful for a named (non-walk-in) customer. A private (B2C)
    // customer gets a simple receipt by default and no invoice number is
    // consumed unless this is explicitly checked. A company customer
    // (isCompany/validated VAT number) always gets a real invoice regardless
    // of this flag — completePointOfSaleSale decides that server-side.
    requestInvoice: z.boolean().optional().default(false),
    items: z
      .array(z.discriminatedUnion("type", [productLineSchema, serviceLineSchema]))
      .min(1, "Ajoutez au moins un produit ou une prestation."),
    method: z.enum(["CASH", "CARD_QR", "EXTERNAL_TERMINAL"], { error: "Choisissez le mode de paiement." }),
    attemptKey: z.string().trim().min(16).max(100).optional().nullable(),
    terminalApproved: z.boolean().optional(),
    terminalReference: z.string().trim().max(100).optional().nullable(),
    cashReceived: z.coerce.number().nonnegative().optional().nullable(),
  })
  .refine((data) => data.method !== "EXTERNAL_TERMINAL" || data.terminalApproved === true, {
    message: "Confirmez que le terminal affiche « APPROUVÉ » avant d'encaisser.",
    path: ["terminalApproved"],
  })
  .refine((data) => data.method !== "EXTERNAL_TERMINAL" || Boolean(data.terminalReference?.trim()), {
    message: "La référence du ticket terminal est obligatoire.",
    path: ["terminalReference"],
  })
  .refine((data) => data.method !== "CASH" || data.cashReceived != null, {
    message: "Indiquez le montant reçu en espèces.",
    path: ["cashReceived"],
  })
  .refine((data) => data.customer !== null || data.method !== "CARD_QR", {
    message: "Le paiement par QR nécessite un client identifié (un e-mail est requis pour le reçu Stripe).",
    path: ["customer"],
  });
