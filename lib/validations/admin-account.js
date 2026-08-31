import { z } from "zod";
import { fullNameSchema } from "@/lib/validations/customer-identity";

// A trusted existing ADMIN/OWNER is typing this in, not a random public
// signup — unlike registration, this deliberately skips the disposable-email
// deny-list in customer-identity.js, which exists for self-service abuse
// prevention, not for this case.
export const createAdminAccountSchema = z.object({
  fullName: fullNameSchema,
  email: z
    .string()
    .trim()
    .toLowerCase()
    .min(1, "L'adresse e-mail est obligatoire.")
    .email("Adresse e-mail invalide."),
});
