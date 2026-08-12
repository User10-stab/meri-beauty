import { z } from "zod";

// A trusted existing ADMIN/OWNER is typing this in, not a random public
// signup — unlike registration, this deliberately skips the disposable-email
// deny-list in customer-identity.js, which exists for self-service abuse
// prevention, not for this case.
export const createAdminAccountSchema = z.object({
  fullName: z.string().trim().min(2, "Le nom complet est obligatoire.").max(100),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .min(1, "L'adresse e-mail est obligatoire.")
    .email("Adresse e-mail invalide."),
});
