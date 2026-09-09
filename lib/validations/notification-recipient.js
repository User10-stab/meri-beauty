import { z } from "zod";

// A trusted ADMIN/OWNER manages this internal address book from the delivery
// dialog — like createAdminAccountSchema, it deliberately skips the public
// disposable-email deny-list, which exists for self-service abuse, not this.
export const notificationRecipientSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .min(1, "L'adresse e-mail est obligatoire.")
    .email("Adresse e-mail invalide."),
  label: z.string().trim().max(80, "Le libellé est trop long.").optional().nullable(),
  isDefault: z.boolean().optional(),
});
