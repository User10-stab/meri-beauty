import { z } from "zod";
import { isValidVatFormat, normalizeVatNumber } from "@/lib/vat-validation";

function parseDateOnly(value) {
  if (typeof value !== "string") return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match) {
    const [, year, month, day] = match;
    return new Date(Number(year), Number(month) - 1, Number(day));
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function startOfToday() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function isBeforeToday(value) {
  const date = parseDateOnly(value);
  if (!date) return false;
  date.setHours(0, 0, 0, 0);
  return date < startOfToday();
}

// ─── Individual field schemas ─────────────────────────────────────────────────

const rentalTypeSchema = z
  .string({ error: "Le type de location est obligatoire." })
  .trim()
  .min(1, "Le type de location ne peut pas être vide.")
  .max(100, "Le type de location ne peut pas dépasser 100 caractères.");

const startDateSchema = z
  .string({ error: "La date de début est obligatoire." })
  .refine((v) => parseDateOnly(v) !== null, "Date de début invalide.")
  .refine((v) => !isBeforeToday(v), "La date de début ne peut pas être dans le passé.");

const desiredPaceSchema = z
  .enum(["1_day_per_week", "2_days_per_week", "3_days_per_week", "full_week"], {
    error: (issue) =>
      issue.input === undefined
        ? undefined
        : "Rythme souhaité invalide.",
  })
  .optional()
  .nullable();

const commissionTypeSchema = z.enum(["PERCENTAGE", "FIXED", "HYBRID"], {
  error: (issue) => (issue.input === undefined ? "Le type de commission est obligatoire." : "Type de commission invalide."),
});

const statusSchema = z.enum(["PENDING", "APPROVED", "REJECTED", "CANCELLED"], {
  error: (issue) => (issue.input === undefined ? "Le statut est obligatoire." : "Statut invalide."),
});

const messageSchema = z
  .string()
  .trim()
  .optional()
  .nullable();

const specialtySchema = z
  .string({ error: "La spécialité est obligatoire." })
  .trim()
  .min(1, "La spécialité est obligatoire.")
  .max(100, "La spécialité ne peut pas dépasser 100 caractères.");

// Offline format + Belgian checksum. No VIES call here: a live lookup has no
// business inside a Zod schema (VIES is a free EU service with no SLA, and a
// timeout must never read as "invalid"). Format alone already rejects the
// typos and the free-text garbage this field accepted until now.
// `error`, not `required_error`: this project is on Zod 4, where
// required_error / invalid_type_error / errorMap are accepted by the type
// system but silently ignored at runtime — the customer gets Zod's English
// default instead ("Invalid input: expected string, received undefined").
const vatNumberBase = z
  .string({ error: "Le numéro de TVA est obligatoire." })
  .trim()
  .min(1, "Le numéro de TVA est obligatoire.")
  .max(50, "Le numéro de TVA ne peut pas dépasser 50 caractères.")
  .transform(normalizeVatNumber)
  .refine(isValidVatFormat, {
    message:
      "Numéro de TVA invalide. Indiquez le préfixe du pays, par exemple BE0751854027.",
  });

// Facultatif depuis 2026-10 (décision de la cliente, audit MB-004) : une
// candidate peut écrire avant d’avoir son numéro. Le format reste vérifié dès
// qu’une valeur est saisie ; une chaîne vide vaut « pas de numéro ». Il est
// aussi facultatif à l’onboarding (createStaffFromRental) : Marie l’ajoute
// sur la fiche staff quand elle l’obtient.
const vatNumberSchema = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
  vatNumberBase.optional().nullable()
);

// Admin-side edits (status, owner response) must not have to resend the VAT
// number — but if one is sent, it goes through exactly the same check.
const optionalVatNumberSchema = vatNumberBase.optional().nullable();

const ownerResponseSchema = z
  .string()
  .trim()
  .max(1000, "La réponse du propriétaire ne peut pas dépasser 1000 caractères.")
  .optional()
  .nullable();

// ─── Coordonnées de la candidate (audit MB-004) ───────────────────────────────
// Le formulaire « Vous souhaitez nous rejoindre ? » promettait « Nous
// reviendrons vers vous rapidement » sans demander ni nom, ni e-mail, ni
// téléphone. Mêmes règles côté navigateur (BecomePartner.jsx) et ici.

export const CONTACT_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Numéro belge (« 0470 12 34 56 ») ou international (« +33 6 12 34 56 78 »). */
export function isPlausibleContactPhone(phone) {
  if (typeof phone !== "string") return false;
  const compact = phone.trim().replace(/[\s()./-]/g, "");
  return /^\+?\d{8,15}$/.test(compact);
}

const firstNameSchema = z
  .string({ error: "Le prénom est obligatoire." })
  .trim()
  .min(1, "Le prénom est obligatoire.")
  .max(100, "Le prénom ne peut pas dépasser 100 caractères.");

const lastNameSchema = z
  .string({ error: "Le nom est obligatoire." })
  .trim()
  .min(1, "Le nom est obligatoire.")
  .max(100, "Le nom ne peut pas dépasser 100 caractères.");

const contactEmailSchema = z
  .string({ error: "L’adresse e-mail est obligatoire." })
  .trim()
  .toLowerCase()
  .min(1, "L’adresse e-mail est obligatoire.")
  .max(254, "L’adresse e-mail est trop longue.")
  .refine((v) => CONTACT_EMAIL_PATTERN.test(v), "Adresse e-mail invalide.");

const contactPhoneSchema = z
  .string({ error: "Le numéro de téléphone est obligatoire." })
  .trim()
  .min(1, "Le numéro de téléphone est obligatoire.")
  .max(30, "Le numéro de téléphone est trop long.")
  .refine(isPlausibleContactPhone, "Numéro de téléphone invalide.");

// ─── Create schema ────────────────────────────────────────────────────────────

export const createRentalRequestSchema = z
  .object({
    rentalType: rentalTypeSchema,
    startDate: startDateSchema,
    desiredPace: desiredPaceSchema,
    commissionType: commissionTypeSchema,
    specialty: specialtySchema,
    vatNumber: vatNumberSchema,
    message: messageSchema,
    firstName: firstNameSchema,
    lastName: lastNameSchema,
    email: contactEmailSchema,
    phone: contactPhoneSchema,
  });

// ─── Update schema ────────────────────────────────────────────────────────────

export const updateRentalRequestSchema = z
  .object({
    id: z.string({ error: "Identifiant manquant." }).min(1),
    rentalType: rentalTypeSchema.optional(),
    startDate: startDateSchema.optional(),
    desiredPace: desiredPaceSchema,
    commissionType: commissionTypeSchema.optional(),
    status: statusSchema.optional(),
    specialty: specialtySchema.optional(),
    vatNumber: optionalVatNumberSchema,
    message: messageSchema,
    ownerResponse: ownerResponseSchema,
  });

// ─── Status update schema ─────────────────────────────────────────────────────

export const updateRentalRequestStatusSchema = z.object({
  id: z.string({ error: "Identifiant manquant." }).min(1),
  status: statusSchema,
  ownerResponse: ownerResponseSchema,
});
