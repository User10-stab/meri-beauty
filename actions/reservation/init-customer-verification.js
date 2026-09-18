"use server";

import bcrypt from "bcrypt";
import { prisma } from "@/lib/prisma";
import { sendVerificationEmail } from "@/actions/auth/verify-email";
import { getClientIp, isRateLimited, recordRateLimitHit } from "@/lib/rate-limit";
import { buildNewsletterConsentUpdate } from "@/lib/newsletter-consent";
import { validateCustomerIdentity } from "@/lib/validations/customer-identity";
import { refineCompanyVat } from "@/lib/validations/register";
import { isSafeReturnPath } from "@/lib/verify-email-link";
import countriesData from "@/data/countries.json";

const BCRYPT_SALT_ROUNDS = 12;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 3;

/**
 * Resolves a 2-letter country code from either a code ("BE") or a localized
 * country name ("Belgique") — the reservation form stores names while VAT
 * validation reasons in codes. Falls back to "BE".
 */
function resolveCountryCode(value) {
  const raw = String(value ?? "").trim();
  if (/^[A-Za-z]{2}$/.test(raw)) return raw.toUpperCase();
  const match = countriesData.find((c) => c.name?.toLowerCase() === raw.toLowerCase());
  return match?.code ?? "BE";
}

/**
 * Creates or finds a pending customer, then sends a verification email.
 * 
 * Only advances the user past the CustomerInfoStep once their email has been
 * verified via the link sent to their inbox.
 *
 * The account is always created with the password the client chose in the
 * reservation form — no password is ever auto-generated here and no email
 * containing credentials is ever sent.
 * 
 * @param {{
 *   fullName: string,
 *   email: string,
 *   phone: string,
 *   password: string,
 *   newsletterSubscribed?: boolean,
 *   isCompany?: boolean,
 *   companyLegalName?: string,
 *   vatNumber?: string,
 *   addressLine1?: string,
 *   addressLine2?: string,
 *   addressCity?: string,
 *   addressPostalCode?: string,
 *   addressCountry?: string,
 *   returnTo?: string,
 * }} input
 * @returns {Promise<{ verified: boolean, message: string }>}
 */
export async function initCustomerVerification({ 
  fullName, 
  email, 
  phone, 
  password,
  newsletterSubscribed,
  isCompany,
  companyLegalName,
  vatNumber,
  addressLine1,
  addressLine2,
  addressCity,
  addressPostalCode,
  addressCountry,
  returnTo,
}) {
  const validation = validateCustomerIdentity({ fullName, email, phone }, { requirePhone: true });
  if (!validation.success) {
    return { verified: false, field: validation.field, message: validation.message };
  }
  const { fullName: validFullName, email: normalizedEmail, phone: validPhone } = validation.data;

  // The client-chosen password is mandatory: it becomes the account password
  // directly. Nothing is generated as a fallback.
  const providedPassword = typeof password === "string" ? password : "";
  if (!providedPassword) {
    return {
      verified: false,
      field: "password",
      message: "Veuillez choisir un mot de passe.",
    };
  }
  if (providedPassword.length < 8 || providedPassword.length > 72) {
    return {
      verified: false,
      field: "password",
      message: "Le mot de passe doit contenir au moins 8 caractères.",
    };
  }

  // Post-verification return path (the reservation the client was
  // completing). Strictly validated: an invalid value is dropped, never
  // trusted — verification itself does not depend on it.
  const safeReturnTo = isSafeReturnPath(returnTo) ? String(returnTo) : null;

  // Entreprise accounts must bring the same complete company identity the
  // signup flow requires — invoicing cannot use them otherwise (no
  // VIES-validated VAT number means ticket-only, and formatUserAddress()
  // needs rue + ville + code postal for the buyer address). Reuses the
  // signup VAT rule through a minimal issue collector.
  if (isCompany) {
    const countryCode = resolveCountryCode(addressCountry);
    const issues = [];
    refineCompanyVat(
      {
        isCompany: true,
        companyLegalName: companyLegalName?.trim() || "",
        vatNumber: vatNumber?.trim() || "",
        addressCountry: countryCode,
      },
      { addIssue: (issue) => issues.push(issue) }
    );
    if (!addressLine1?.trim()) {
      issues.push({ path: ["addressLine1"], message: "L'adresse est obligatoire pour un compte entreprise." });
    }
    if (!addressCity?.trim()) {
      issues.push({ path: ["addressCity"], message: "La ville est obligatoire pour un compte entreprise." });
    }
    if (!addressPostalCode?.trim()) {
      issues.push({ path: ["addressPostalCode"], message: "Le code postal est obligatoire pour un compte entreprise." });
    }
    if (issues.length > 0) {
      const first = issues[0];
      return {
        verified: false,
        field: Array.isArray(first.path) ? first.path[0] : "vatNumber",
        message: first.message,
      };
    }
  }

  const ip = await getClientIp();
  const rateLimitKey = `${normalizedEmail}:${ip}`;
  if (isRateLimited("init-customer-verification", rateLimitKey, { windowMs: RATE_LIMIT_WINDOW_MS, max: RATE_LIMIT_MAX_REQUESTS })) {
    return {
      verified: false,
      message: "Trop de tentatives. Veuillez patienter avant de réessayer.",
    };
  }
  recordRateLimitHit("init-customer-verification", rateLimitKey);

  // 1. Check if user already exists and is verified
  const existingUser = await prisma.user.findFirst({
    where: {
      email: normalizedEmail,
      isDeleted: false,
    },
    select: { id: true, emailVerified: true },
  });

  if (existingUser?.emailVerified) {
    return {
      verified: true,
      message: " Votre email est déjà vérifié. Vous pouvez continuer.",
    };
  }

  // 2. Create the user if they don't exist yet, with the client-chosen
  // password directly. No password is ever generated and no credentials
  // email is ever sent — the customer already knows their password.
  if (!existingUser) {
    const hashedPassword = await bcrypt.hash(providedPassword, BCRYPT_SALT_ROUNDS);

    const created = await prisma.user.create({
      data: {
        fullName: validFullName,
        email: normalizedEmail,
        phone: validPhone,
        password: hashedPassword,
        role: "CUSTOMER",
        emailVerified: false,
        isActive: true,
        isCompany: isCompany ?? false,
        vatNumber: vatNumber?.trim() || null,
        addressLine1: addressLine1?.trim() || null,
        addressLine2: addressLine2?.trim() || null,
        addressCity: addressCity?.trim() || null,
        addressPostalCode: addressPostalCode?.trim() || null,
        addressCountry: addressCountry?.trim() || "BE",
        ...buildNewsletterConsentUpdate(newsletterSubscribed ?? false, "appointment_booking"),
      },
    });

    // Entreprise legal identity for future B2B invoices (same BillingProfile
    // the signup flow creates). The invoice itself still requires a live
    // VIES validation, refreshable later from the profile/checkout.
    if (created && isCompany && companyLegalName?.trim()) {
      await prisma.billingProfile.create({
        data: { userId: created.id, companyLegalName: companyLegalName.trim() },
      });
    }
  } else {
    // User exists but not verified — update their info with latest data
    await prisma.user.update({
      where: { id: existingUser.id },
      data: {
        fullName: validFullName,
        phone: validPhone,
        password: await bcrypt.hash(providedPassword, BCRYPT_SALT_ROUNDS),
        isCompany: isCompany ?? false,
        vatNumber: vatNumber?.trim() || null,
        addressLine1: addressLine1?.trim() || null,
        addressLine2: addressLine2?.trim() || null,
        addressCity: addressCity?.trim() || null,
        addressPostalCode: addressPostalCode?.trim() || null,
        addressCountry: addressCountry?.trim() || "BE",
        ...buildNewsletterConsentUpdate(newsletterSubscribed ?? false, "appointment_booking"),
      },
    });

    if (isCompany && companyLegalName?.trim()) {
      await prisma.billingProfile.upsert({
        where: { userId: existingUser.id },
        update: { companyLegalName: companyLegalName.trim() },
        create: { userId: existingUser.id, companyLegalName: companyLegalName.trim() },
      });
    }
  }

  // 3. Send the verification email (fire-and-forget the result is irrelevant —
  //    the action always succeeds if email is reachable; failures are logged
  //    internally by sendVerificationEmail). The token carries the reservation
  //    return context so one click verifies the address and brings the client
  //    straight back to their booking.
  await sendVerificationEmail(
    {
      fullName: validFullName,
      email: normalizedEmail,
    },
    {
      resumeType: "RESERVATION",
      resumeId: safeReturnTo,
      emailVariant: "reservation",
    }
  );

  return {
    verified: false,
    // Distinguishes "verification email sent, continue there" from
    // validation/rate-limit failures (same shape, no field) so the caller
    // shows the waiting state only when an email really went out.
    emailSent: true,
    message:
      "Un email de vérification vous a été envoyé. Veuillez vérifier votre boîte de réception et cliquer sur le lien avant de continuer.",
  };
}
