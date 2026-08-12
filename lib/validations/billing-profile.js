import { z } from "zod";

export const billingProfileSchema = z.object({
  companyLegalName: z.string().trim().min(2, "La raison sociale est obligatoire.").max(150),
  companyRegistrationNo: z.string().trim().max(30).optional().nullable(),
  companyLegalForm: z.string().trim().max(50).optional().nullable(),
  billingContactName: z.string().trim().max(100).optional().nullable(),
  purchaseOrderReference: z.string().trim().max(100).optional().nullable(),
});
