import { z } from "zod";

const TIME_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/;

const phoneRegex = /^[+]?[\d\s()/-]+$/;

export const updatePersonalInfoSchema = z.object({
  fullName: z
    .string()
    .trim()
    .min(2, "Le nom complet doit contenir au moins 2 caractères.")
    .max(100, "Le nom complet ne peut pas dépasser 100 caractères.")
    .optional(),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email("Veuillez saisir une adresse e-mail valide.")
    .optional(),
  phone: z
    .string()
    .trim()
    .min(8, "Le numéro de téléphone doit contenir au moins 8 caractères.")
    .max(20, "Le numéro de téléphone ne peut pas dépasser 20 caractères.")
    .regex(phoneRegex, "Le numéro de téléphone ne peut contenir que des chiffres, espaces et les caractères + ( ) - /.")
    .optional(),
  currentPassword: z
    .string({ error: "Le mot de passe actuel est obligatoire." })
    .min(1, "Le mot de passe actuel est obligatoire."),
  newPassword: z
    .string()
    .min(8, "Le nouveau mot de passe doit contenir au moins 8 caractères.")
    .max(128, "Le mot de passe est trop long.")
    .optional(),
});

export const updateStaffProfileSchema = z.object({
  photo: z.string().optional().nullable(),
  bio: z.string().trim().max(500, "La biographie ne peut pas dépasser 500 caractères.").optional().nullable(),
  languages: z.array(z.string().trim().min(1)).min(1, "Veuillez ajouter au moins une langue."),
  yearsOfExperience: z.coerce.number().int().min(0).max(60).optional().nullable(),
});

export const staffContractSchema = z.object({
  fixedRent: z.coerce.number({
    error: (issue) =>
      issue.input === undefined
        ? "Le montant du loyer est obligatoire."
        : "Le loyer doit être un nombre.",
  }).min(0, "Le loyer ne peut pas être négatif."),
  startDate: z.string({ error: "La date de début du contrat est obligatoire." })
    .refine((v) => !isNaN(Date.parse(v)), "Date de début invalide."),
  endDate: z.string().optional().nullable()
    .refine((v) => !v || !isNaN(Date.parse(v)), "Date de fin invalide."),
  notes: z.string().trim().max(1000, "Les notes ne peuvent pas dépasser 1000 caractères.").optional().nullable(),
}).superRefine((data, ctx) => {
  if (data.endDate && data.startDate && new Date(data.endDate) <= new Date(data.startDate)) {
    ctx.addIssue({
      path: ["endDate"],
      code: z.ZodIssueCode.custom,
      message: "La date de fin doit être postérieure à la date de début.",
    });
  }
});

export const updateReservationSettingsSchema = z.object({
  confirmationMode: z.enum(["AUTOMATIC", "MANUAL"], {
    error: "Le mode de confirmation est obligatoire.",
  }),
  depositEnabled: z.boolean(),
  depositPercentage: z.coerce.number({
    error: "Le pourcentage doit être un nombre.",
  })
    .min(0, "Le pourcentage ne peut pas être négatif.")
    .max(100, "Le pourcentage ne peut pas dépasser 100.")
    .optional()
    .nullable(),
}).superRefine((data, ctx) => {
  if (data.depositEnabled && (data.depositPercentage == null || data.depositPercentage <= 0)) {
    ctx.addIssue({
      path: ["depositPercentage"],
      code: z.ZodIssueCode.custom,
      message: "Veuillez saisir un pourcentage valide lorsque les acomptes sont activés.",
    });
  }
});

const singleDaySchema = z.object({
  day: z.enum(["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"]),
  startTime: z.string().trim(),
  endTime: z.string().trim(),
  isClosed: z.boolean(),
}).refine(
  (data) => {
    if (data.isClosed) return true;
    if (!TIME_REGEX.test(data.startTime) || !TIME_REGEX.test(data.endTime)) return false;
    return data.startTime < data.endTime;
  },
  { message: "L'heure de début doit être antérieure à l'heure de fin.", path: ["startTime"] }
);

export const staffWorkingHoursSchema = z.object({
  days: z.array(singleDaySchema).length(7, "Les 7 jours de la semaine sont obligatoires."),
});

export const staffTimeOffSchema = z.object({
  startDate: z.string({ error: "La date de début est obligatoire." })
    .refine((v) => !isNaN(Date.parse(v)), "Date de début invalide."),
  endDate: z.string({ error: "La date de fin est obligatoire." })
    .refine((v) => !isNaN(Date.parse(v)), "Date de fin invalide."),
  reason: z.string().trim().max(500, "Le motif ne peut pas dépasser 500 caractères.").optional().nullable(),
}).superRefine((data, ctx) => {
  if (new Date(data.endDate) < new Date(data.startDate)) {
    ctx.addIssue({
      path: ["endDate"],
      code: z.ZodIssueCode.custom,
      message: "La date de fin doit être postérieure ou égale à la date de début.",
    });
  }
});
