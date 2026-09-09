import { z } from "zod";
import { customerEmailSchema } from "@/lib/validations/customer-identity";
import { counterCustomerSchema } from "@/lib/validations/counter-customer";

// Moved to lib/validations/counter-customer.js so it can be shared with
// actions/counter/walk-in-service.js (and, later, a counter reservation
// action) instead of each screen keeping its own narrower ad-hoc shape.
// Re-exported here, under its original name, so nothing importing it from
// this file needs to change.
const customerSchema = counterCustomerSchema;

// A "client de passage" gives no name, so this can never become a real
// Invoice (customerName/customerEmail are non-null there). Genuinely
// optional now — staff can uncheck the till's "collect e-mail" nudge and
// send an empty string, and the sale still goes through with no ticket
// e-mailed (see the removed mandatory-email refine below).
const walkInEmailSchema = z.union([customerEmailSchema, z.literal("")]).optional().transform((value) => value || "");

const productLineSchema = z.object({
  type: z.literal("PRODUCT"),
  variantId: z.string().min(1),
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
    // named customer receives the ticket on their account e-mail.
    walkInEmail: walkInEmailSchema,
    items: z.array(productLineSchema).min(1, "Ajoutez au moins un produit."),
    method: z.enum(["CASH", "CARD_QR", "EXTERNAL_TERMINAL"], { error: "Choisissez le mode de paiement." }),
    attemptKey: z.string().trim().min(16).max(100).optional().nullable(),
    // Only meaningful when the resolved customer is VAT-eligible — ignored
    // otherwise. Defaults to true (today's behavior) when omitted.
    invoiceRequested: z.boolean().optional(),
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
