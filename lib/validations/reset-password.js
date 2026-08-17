import { z } from "zod";

export const resetPasswordSchema = z
  .object({
    token: z
      .string()
      .min(1, "Lien de réinitialisation manquant.")
      .optional(),
    password: z
      .string()
      .min(8, "Le mot de passe doit contenir au moins 8 caractères.")
      .max(72, "Le mot de passe ne peut pas dépasser 72 caractères."),
    confirmPassword: z.string().min(1, "Veuillez confirmer votre mot de passe."),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Les mots de passe ne correspondent pas.",
    path: ["confirmPassword"],
  });
