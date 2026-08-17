import { z } from "zod";

export const staffServiceAssignmentSchema = z.object({
  staffId: z.string().trim().min(1, "Le professionnel est obligatoire."),
  serviceId: z.string().trim().min(1, "Le service est obligatoire."),
  price: z.coerce.number({ error: "Le prix est invalide." }).nonnegative("Le prix ne peut pas être négatif."),
  duration: z.coerce.number({ error: "La durée est invalide." }).int("La durée doit être un nombre entier.").nonnegative("La durée ne peut pas être négative."),
  margin: z.coerce.number({ error: "La marge est invalide." }).nonnegative("La marge ne peut pas être négative.").optional().nullable(),
  photo: z.string().trim().max(500, "L’URL de la photo est trop longue.").optional().nullable(),
  isActive: z.boolean().optional(),
});

export const staffServiceUpdateSchema = z.object({
  id: z.string().trim().min(1, "L’assignation est introuvable."),
  price: z.coerce.number({ error: "Le prix est invalide." }).nonnegative("Le prix ne peut pas être négatif.").optional(),
  duration: z.coerce.number({ error: "La durée est invalide." }).int("La durée doit être un nombre entier.").nonnegative("La durée ne peut pas être négative.").optional(),
  margin: z.coerce.number({ error: "La marge est invalide." }).nonnegative("La marge ne peut pas être négative.").optional().nullable(),
  photo: z.string().trim().max(500, "L’URL de la photo est trop longue.").optional().nullable(),
  isActive: z.boolean().optional(),
});
