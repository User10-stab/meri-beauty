import { z } from "zod";

export const billingProfileSchema = z.object({
  companyLegalName: z.string().trim().min(2, "La raison sociale est obligatoire.").max(150),
  companyRegistrationNo: z.string().trim().max(30).optional().nullable(),
  companyLegalForm: z.string().trim().max(50).optional().nullable(),
  billingContactName: z.string().trim().max(100).optional().nullable(),
  purchaseOrderReference: z.string().trim().max(100).optional().nullable(),
  // Peppol network address, "schemeID:value" (e.g. "9925:BE0823758741" — 9925
  // is the Peppol scheme for a Belgian enterprise number). Parsed the same
  // way in lib/billit.js#parsePeppolIdentifier when a facture is sent.
  peppolParticipantId: z
    .string()
    .trim()
    .max(50)
    .optional()
    .nullable()
    .refine((v) => !v || /^\d{4}:[\w.-]+$/.test(v), {
      message: "Format attendu : 9925:BE0123456789 (schéma Peppol : identifiant).",
    }),
});
