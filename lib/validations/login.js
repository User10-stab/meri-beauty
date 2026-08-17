import { z } from "zod";

export const loginSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email("Veuillez saisir une adresse e-mail valide."),
  password: z
    .string()
    .min(1, "Le mot de passe est obligatoire.")
    .max(72, "Le mot de passe ne peut pas dépasser 72 caractères."),
});
