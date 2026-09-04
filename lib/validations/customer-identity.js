import { z } from "zod";

// This is deliberately a small, reviewed deny-list rather than a fragile
// network lookup. It covers the disposable providers most commonly used for
// account abuse. Add customer-facing exceptions through the support process,
// not by weakening validation in individual forms.
const DISPOSABLE_EMAIL_DOMAINS = new Set([
  "10minutemail.com", "dispostable.com", "dropmail.me", "emailondeck.com",
  "fakeinbox.com", "fakemail.net", "getnada.com", "guerrillamail.com",
  "inboxkitten.com", "mail.tm", "maildrop.cc", "mailinator.com",
  "mailnesia.com", "minuteinbox.com", "moakt.com", "sharklasers.com",
  "tempmail.com", "tempmail.net", "tempmailo.com", "throwawaymail.com",
  "trashmail.com", "trashmail.net", "yopmail.com",
]);

const DISPOSABLE_DOMAIN_PATTERNS = [
  /(^|[.-])(?:temp|tempmail|throwaway|disposable|guerrilla|trash|fake)mail([.-]|$)/i,
  /(^|[.-])mailinator([.-]|$)/i,
];

export function normalizeEmail(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function isDisposableEmail(value) {
  const email = normalizeEmail(value);
  const domain = email.split("@")[1];
  if (!domain) return false;

  return DISPOSABLE_EMAIL_DOMAINS.has(domain)
    || [...DISPOSABLE_EMAIL_DOMAINS].some((blocked) => domain.endsWith(`.${blocked}`))
    || DISPOSABLE_DOMAIN_PATTERNS.some((pattern) => pattern.test(domain));
}

export const customerEmailSchema = z
  .string({ error: "L'adresse e-mail est obligatoire." })
  .trim()
  .toLowerCase()
  .max(254, "L'adresse e-mail est trop longue.")
  .email("Adresse e-mail invalide.")
  .superRefine((email, ctx) => {
    if (isDisposableEmail(email)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Les adresses e-mail temporaires ne sont pas acceptées.",
      });
    }
  });

// The single source of truth for "is this a real name" across the app —
// registration, profile edits, admin/staff account creation, POS walk-in
// customers, checkout, and bookings all import this rather than each rolling
// their own check. Before this was centralized, only the booking path (this
// file) rejected digits; registration and the profile editor accepted names
// like "User122" outright, so an account could pass signup, get stuck dead
// (no error shown at all — see the 2026-08-31 incident) the first time it
// tried to book a workshop/formation, with the mismatch invisible until then.
//
// A dedicated digit check comes first so the message names the actual
// problem ("chiffres") instead of the generic "caractères non autorisés",
// which a customer can't act on.
export const fullNameSchema = z
  .string({ error: "Le nom complet est obligatoire." })
  .trim()
  .min(2, "Le nom complet doit comporter au moins 2 caractères.")
  .max(100, "Le nom complet ne peut pas dépasser 100 caractères.")
  .superRefine((value, ctx) => {
    if (/\d/.test(value)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Le nom ne peut pas contenir de chiffres." });
      return;
    }
    if (!/^[\p{L}\p{M}][\p{L}\p{M}' .-]*$/u.test(value)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Le nom ne peut contenir que des lettres, espaces, apostrophes et tirets.",
      });
    }
  });

const phoneSchema = z
  .string()
  .trim()
  .min(8, "Le numéro de téléphone doit comporter au moins 8 caractères.")
  .max(20, "Le numéro de téléphone ne peut pas dépasser 20 caractères.")
  .regex(/^[+]?\d[\d\s().-]*$/, "Le numéro de téléphone est invalide.");

const optionalPhoneSchema = z.union([phoneSchema, z.literal("")]).optional().transform((value) => value || "");

export const customerIdentitySchema = z.object({
  fullName: fullNameSchema,
  email: customerEmailSchema,
  phone: optionalPhoneSchema,
});

export const customerIdentityWithPhoneSchema = z.object({
  fullName: fullNameSchema,
  email: customerEmailSchema,
  phone: phoneSchema,
});

/** Validates user-controlled customer data before any account or hold is created. */
export function validateCustomerIdentity(input, { requirePhone = false } = {}) {
  const schema = requirePhone ? customerIdentityWithPhoneSchema : customerIdentitySchema;
  const parsed = schema.safeParse(input ?? {});
  if (parsed.success) return { success: true, data: parsed.data };

  const issue = parsed.error.issues[0];
  return { success: false, field: issue.path[0] ?? "customerInfo", message: issue.message };
}

// Same rules as actions/customer/settings.js#updateMyAddress — kept as the
// single source of truth so a guest account created mid-booking (see
// actions/workshops/create-workshop-reservation.js and
// actions/formations/create-formation-reservation.js) and a signed-in
// customer editing their profile can never drift apart on what counts as a
// complete billing address.
export function validateBillingAddress(input) {
  const addressLine1 = input?.addressLine1?.trim();
  const addressCity = input?.addressCity?.trim();
  const addressPostalCode = input?.addressPostalCode?.trim();

  if (!addressLine1 || addressLine1.length < 3) {
    return { success: false, field: "addressLine1", message: "L'adresse est obligatoire." };
  }
  if (!addressCity || addressCity.length < 2) {
    return { success: false, field: "addressCity", message: "La ville est obligatoire." };
  }
  if (!addressPostalCode || addressPostalCode.length < 3) {
    return { success: false, field: "addressPostalCode", message: "Le code postal est obligatoire." };
  }

  return {
    success: true,
    data: {
      addressLine1,
      addressLine2: input?.addressLine2?.trim() || null,
      addressCity,
      addressPostalCode,
      addressCountry: input?.addressCountry?.trim() || "BE",
    },
  };
}
