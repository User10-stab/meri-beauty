import { z } from "zod";
import { counterCustomerSchema } from "@/lib/validations/counter-customer";
import {
  MANUAL_INVOICE_MAX_LINES,
  MANUAL_INVOICE_METHODS,
  MANUAL_INVOICE_NOTES_MAX,
} from "@/lib/invoices/manual-invoice-constants";

/**
 * Input shapes for an invoice sale composed at la caisse (CounterCart,
 * actions/invoices/manual-invoice.js).
 *
 * Kept out of the "use server" action file: Next.js requires every export
 * of such a module to be an async function, and a plain constant exported
 * there silently drops ALL of the module's exports at build time.
 */

// The buyer is the till's own customer shape, with one difference: an
// invoice is only ever issued to a VAT-registered buyer (issueInvoice's
// B2C_INVOICE_NOT_ALLOWED), so the number is mandatory here rather than
// failing late, after the admin filled in every line.
const manualInvoiceCustomerSchema = counterCustomerSchema.refine((customer) => Boolean(customer.vatNumber), {
  message: "Le numéro de TVA du client est obligatoire pour émettre une facture.",
  path: ["vatNumber"],
});

// Catalogue line: the price is never taken from the client — the action
// re-reads the variant, exactly like the till.
const productLineSchema = z.object({
  type: z.literal("PRODUCT"),
  variantId: z.string().min(1),
  quantity: z.coerce.number().int().positive().max(999),
});

// Free-text line. unitPrice is VAT-inclusive, like every price in the app
// (allocateNetLines derives the art. 226(8) net columns from it). For a
// reverse-charge buyer the rate is 0 %, so the typed amount is also the net.
const freeLineSchema = z.object({
  type: z.literal("FREE"),
  description: z.string().trim().min(1, "Chaque ligne libre doit avoir une description.").max(200),
  quantity: z.coerce.number().int().positive().max(999),
  unitPrice: z.coerce
    .number()
    .positive("Le prix d'une ligne libre doit être supérieur à 0.")
    .max(100000)
    .transform((value) => Math.round(value * 100) / 100),
});

const lineSchema = z.discriminatedUnion("type", [productLineSchema, freeLineSchema]);

// Shared by « encaisser maintenant » and the later « Encaisser » dialog.
const paymentFields = {
  method: z.enum(MANUAL_INVOICE_METHODS, { error: "Choisissez le mode de paiement." }),
  cashReceived: z.coerce.number().nonnegative().optional().nullable(),
  reference: z.string().trim().max(100).optional().nullable(),
};

// A transfer's bank reference stays optional: « Accepter » on the Factures
// page is one tick and asks for nothing (user's call, 2026-09-21). It is still
// recorded when the « Autre » dialog is used to type it.
function refinePayment(schema) {
  return schema
    .refine((data) => data.method !== "CASH" || data.cashReceived != null, {
      message: "Indiquez le montant reçu en espèces.",
      path: ["cashReceived"],
    })
    .refine((data) => data.method !== "CARD" || Boolean(data.reference?.trim()), {
      message: "La référence du ticket terminal est obligatoire.",
      path: ["reference"],
    });
}

// A partial amount, in euros and cents. Whether it fits under what is still
// owed is checked server-side against the stored balance, never trusted here.
const partialAmountSchema = z.coerce
  .number({ error: "Montant invalide." })
  .positive("Le montant doit être supérieur à 0.")
  .max(100000)
  .transform((value) => Math.round(value * 100) / 100);

// NOW     — paid in full at once: the invoice is issued immediately;
// DEPOSIT — an acompte now, the balance later;
// LATER   — nothing collected yet. With `awaitedTransferAmount`, the client
//           announced a bank transfer of that amount that has not arrived:
//           still nothing recorded until staff mark it « Virement reçu ».
// DEPOSIT and LATER record a pending sale with no invoice: like every booking
// deposit on the site, the invoice is only issued once the sale is fully paid.
//
// A transfer is never accepted when the sale is recorded — it takes days to
// arrive. It is announced (LATER + awaitedTransferAmount) and only becomes a
// payment when staff approve it with « Virement reçu » (the settlement schema
// below, with its bank reference).
const refuseTransferAtCreation = (schema) =>
  schema.refine((data) => data.method !== "TRANSFER", {
    message: "Un virement reste en attente jusqu'à sa validation : enregistrez la vente, puis « Virement reçu » quand il arrive.",
    path: ["method"],
  });

const settlementSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("LATER"), awaitedTransferAmount: partialAmountSchema.optional().nullable() }),
  refuseTransferAtCreation(refinePayment(z.object({ mode: z.literal("NOW"), ...paymentFields }))),
  refuseTransferAtCreation(refinePayment(z.object({ mode: z.literal("DEPOSIT"), amount: partialAmountSchema, ...paymentFields }))),
]);

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export const manualInvoiceSchema = z.object({
  attemptKey: z.string().trim().min(16).max(100),
  customer: manualInvoiceCustomerSchema,
  lines: z
    .array(lineSchema)
    .min(1, "Ajoutez au moins une ligne.")
    .max(MANUAL_INVOICE_MAX_LINES, `Une facture ne peut pas dépasser ${MANUAL_INVOICE_MAX_LINES} lignes.`),
  notes: z.string().trim().max(MANUAL_INVOICE_NOTES_MAX, `Le commentaire ne peut pas dépasser ${MANUAL_INVOICE_NOTES_MAX} caractères.`).optional().default(""),
  dueDate: z
    .string()
    .regex(DATE_ONLY, "Date d'échéance invalide.")
    .optional()
    .nullable()
    .or(z.literal(""))
    .transform((value) => value || null),
  settlement: settlementSchema,
});

// « Encaisser » on a pending manual sale: the balance by default, or a
// further acompte. The payment that clears the balance issues the invoice.
export const manualInvoiceSettlementSchema = refinePayment(
  z.object({
    orderId: z.string().trim().min(1),
    amount: partialAmountSchema.optional().nullable(),
    ...paymentFields,
  })
);

// « Annuler » on a pending manual sale nothing has been collected on yet.
export const manualSaleCancelSchema = z.object({
  orderId: z.string().trim().min(1),
  reason: z.string().trim().min(3, "Indiquez le motif de l'annulation.").max(300),
});
