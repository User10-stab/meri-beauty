import { z } from "zod";

export const contactFormSchema = z.object({
  name: z
    .string()
    .min(2, "Le nom doit contenir au moins 2 caractères.")
    .max(100, "Le nom ne peut pas dépasser 100 caractères."),
  email: z
    .string()
    .email("Veuillez saisir une adresse email valide."),
  phone: z
    .string()
    .max(30, "Le numéro de téléphone ne peut pas dépasser 30 caractères.")
    .optional()
    .or(z.literal("")),
  subject: z
    .string()
    .min(3, "Le sujet doit contenir au moins 3 caractères.")
    .max(200, "Le sujet ne peut pas dépasser 200 caractères."),
  message: z
    .string()
    .min(10, "Le message doit contenir au moins 10 caractères.")
    .max(5000, "Le message ne peut pas dépasser 5000 caractères."),
});