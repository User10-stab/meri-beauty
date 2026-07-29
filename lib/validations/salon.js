import { z } from "zod";

const WEEK_DAYS = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"];
const TIME_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/;

export const updateSalonSchema = z.object({
  name: z.string().trim().min(1, "Le nom est obligatoire.").max(100),
  description: z.string().trim().max(500, "La description est trop longue.").optional().nullable(),
  phone: z.string().trim().min(8, "Numéro invalide.").max(20),
  email: z.string().trim().email("Email invalide."),
  address: z.string().trim().max(200).optional().nullable(),
  vatNumber: z.string().trim().max(30, "Numéro de TVA trop long.").optional().nullable(),
  instagram: z.string().trim().max(200).optional().nullable(),
  facebook: z.string().trim().max(200).optional().nullable(),
  tiktok: z.string().trim().max(200).optional().nullable(),
});

const singleWorkingDaySchema = z.object({
  day: z.enum(WEEK_DAYS),
  isOpen: z.boolean(),
  openingTime: z.string().optional(),
  closingTime: z.string().optional(),
}).refine((data) => {
  if (!data.isOpen) return true;
  if (!data.openingTime || !data.closingTime) return false;
  if (!TIME_REGEX.test(data.openingTime) || !TIME_REGEX.test(data.closingTime)) return false;
  return data.openingTime < data.closingTime;
}, { message: "L'heure d'ouverture doit être antérieure à l'heure de fermeture.", path: ["openingTime"] });

export const updateWorkingDaysSchema = z.object({
  days: z.array(singleWorkingDaySchema).length(7, "Les 7 jours sont obligatoires."),
});

export const createClosureSchema = z.object({
  title: z.string().trim().min(1, "Le titre est obligatoire.").max(100, "Titre trop long."),
  startDate: z.string({ required_error: "La date de début est obligatoire." }).refine((v) => !isNaN(Date.parse(v)), "Date de début invalide."),
  endDate: z.string().optional().nullable().refine((v) => !v || !isNaN(Date.parse(v)), "Date de fin invalide."),
  isFullDay: z.boolean().default(true),
  openingTime: z.string().optional().nullable(),
  closingTime: z.string().optional().nullable(),
}).refine((data) => {
  if (data.endDate && data.startDate && new Date(data.endDate) <= new Date(data.startDate)) {
    return false;
  }
  return true;
}, { message: "La date de fin doit être postérieure à la date de début.", path: ["endDate"] });

export const deleteClosureSchema = z.object({
  id: z.string().min(1, "Identifiant manquant."),
});
