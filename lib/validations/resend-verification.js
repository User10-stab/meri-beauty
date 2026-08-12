import { z } from "zod";

export const resendVerificationSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email("Veuillez saisir une adresse e-mail valide."),
});
