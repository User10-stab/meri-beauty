import { z } from "zod";
import { customerEmailSchema } from "@/lib/validations/customer-identity";

const customerSchema = z.object({
  id: z.string().min(1).optional().nullable(),
  fullName: z.string().trim().min(2, "Le nom du client est obligatoire.").max(100),
  email: customerEmailSchema,
  phone: z.string().trim().max(20).optional().nullable(),
});

export const pointOfSaleSaleSchema = z.object({
  customer: customerSchema,
  items: z
    .array(
      z.object({
        variantId: z.string().min(1),
        quantity: z.coerce.number().int().positive().max(99),
      })
    )
    .min(1, "Ajoutez au moins un produit."),
  method: z.enum(["CASH", "CARD_QR", "EXTERNAL_TERMINAL"], { required_error: "Choisissez le mode de paiement." }),
  attemptKey: z.string().trim().min(16).max(100).optional().nullable(),
});
