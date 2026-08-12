"use server";

import bcrypt from "bcrypt";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { emailVerificationEmail } from "@/lib/email-templates";
import { registerSchema } from "@/lib/validations/register";
import { getClientIp, isRateLimited, recordRateLimitHit } from "@/lib/rate-limit";
import { buildNewsletterConsentUpdate } from "@/lib/newsletter-consent";
import { buildTermsAcceptanceUpdate } from "@/lib/terms-consent";
import { verifyVatWithVies } from "@/lib/vat-validation";

const BCRYPT_SALT_ROUNDS = 12;
const TOKEN_EXPIRY_MINUTES = 15;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 3;

const userSelect = {
  id: true,
  fullName: true,
  nickName: true,
  email: true,
  phone: true,
  role: true,
  emailVerified: true,
  isActive: true,
  createdAt: true,
};

async function hashToken(token) {
  return bcrypt.hash(token, BCRYPT_SALT_ROUNDS);
}

/**
 * Register a new customer account.
 * @param {{ fullName: string, email: string, phone: string, password: string }} input
 */
export async function registerUser(input) {
  const parsed = registerSchema.safeParse(input);

  if (!parsed.success) {
    const errors = parsed.error.flatten().fieldErrors;

    return {
      success: false,
      message: "Veuillez corriger les erreurs ci-dessous.",
      errors: {
        fullName: errors.fullName?.[0] ?? null,
        email: errors.email?.[0] ?? null,
        phone: errors.phone?.[0] ?? null,
        password: errors.password?.[0] ?? null,
        vatNumber: errors.vatNumber?.[0] ?? null,
        companyLegalName: errors.companyLegalName?.[0] ?? null,
        termsAccepted: errors.termsAccepted?.[0] ?? null,
        addressLine1: errors.addressLine1?.[0] ?? null,
        addressCity: errors.addressCity?.[0] ?? null,
        addressPostalCode: errors.addressPostalCode?.[0] ?? null,
        addressCountry: errors.addressCountry?.[0] ?? null,
      },
    };
  }

  const {
    fullName,
    nickName,
    email,
    phone,
    password,
    isCompany,
    vatNumber,
    companyLegalName,
    companyRegistrationNo,
    companyLegalForm,
    billingContactName,
    addressLine1,
    addressLine2,
    addressCity,
    addressPostalCode,
    addressCountry,
    newsletterSubscribed,
  } = parsed.data;

  const ip = await getClientIp();
  const rateLimitKey = `${email}:${ip}`;
  if (isRateLimited("register", rateLimitKey, { windowMs: RATE_LIMIT_WINDOW_MS, max: RATE_LIMIT_MAX_REQUESTS })) {
    return {
      success: false,
      message: "Trop de tentatives. Veuillez patienter quelques minutes avant de réessayer.",
    };
  }
  recordRateLimitHit("register", rateLimitKey);

  // Invalid VAT still blocks signup. If VIES itself is unavailable, the
  // account can be created with the VAT number pending verification; tax
  // policy later requires vatValidatedAt before granting reverse-charge.
  let vatNumberToSave = null;
  let vatValidation = null;
  let vatVerificationPending = false;
  if (isCompany && vatNumber) {
    const viesResult = await verifyVatWithVies(vatNumber);
    if (!viesResult.success) {
      vatNumberToSave = vatNumber;
      vatVerificationPending = true;
    } else if (!viesResult.valid) {
      return {
        success: false,
        message: "Ce numéro de TVA n'est pas reconnu comme actif par le registre européen VIES.",
        errors: { vatNumber: "Ce numéro de TVA n'est pas reconnu comme actif par le registre européen VIES." },
      };
    } else {
      vatNumberToSave = vatNumber;
      vatValidation = {
        vatValidatedAt: new Date(),
        vatValidationName: viesResult.name ?? null,
        vatValidationAddress: viesResult.address ?? null,
      };
    }
  }

  try {
    const hashedPassword = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);
    const plainToken = crypto.randomUUID();
    const tokenHash = await hashToken(plainToken);
    const expiresAt = new Date(Date.now() + TOKEN_EXPIRY_MINUTES * 60 * 1000);

    const user = await prisma.$transaction(async (tx) => {
      const newUser = await tx.user.create({
        data: {
          fullName,
          nickName,
          email,
          phone,
          password: hashedPassword,
          role: "CUSTOMER",
          emailVerified: false,
          isActive: true,
          isCompany,
          vatNumber: vatNumberToSave,
          ...(vatValidation ?? {}),
          addressLine1,
          addressLine2: addressLine2 || null,
          addressCity,
          addressPostalCode,
          addressCountry,
          ...buildNewsletterConsentUpdate(newsletterSubscribed ?? false, "registration"),
          ...buildTermsAcceptanceUpdate(),
        },
        select: userSelect,
      });

      await tx.emailVerificationToken.create({
        data: {
          email: newUser.email,
          tokenHash,
          expiresAt,
        },
      });

      if (isCompany && companyLegalName) {
        await tx.billingProfile.create({
          data: {
            userId: newUser.id,
            companyLegalName,
            companyRegistrationNo: companyRegistrationNo || null,
            companyLegalForm: companyLegalForm || null,
            billingContactName: billingContactName || null,
          },
        });
      }

      return newUser;
    });

    const verificationUrl = `${
      process.env.NEXTAUTH_URL || "http://localhost:3000"
    }/verify-email?token=${encodeURIComponent(plainToken)}`;

    // The database transaction above has already committed. Email delivery is
    // a follow-up operation, so a provider outage must not make the UI claim
    // that registration failed (and then report the committed email as taken
    // on the next attempt).
    let emailDeliveryFailed = false;
    try {
      const emailTemplate = emailVerificationEmail({
        customerName: user.fullName,
        verificationUrl,
        expiresInMinutes: TOKEN_EXPIRY_MINUTES,
      });

      const emailResult = await sendEmail({
        to: user.email,
        subject: emailTemplate.subject,
        text: emailTemplate.text,
        html: emailTemplate.html,
      });
      emailDeliveryFailed = !emailResult?.success;
    } catch (emailError) {
      emailDeliveryFailed = true;
      console.error("[registerUser] account created but verification email delivery failed", emailError);
    }

    return {
      success: true,
      message: emailDeliveryFailed
        ? "Votre compte a bien été créé, mais l'e-mail de vérification n'a pas pu être envoyé. Vous pouvez demander un nouveau lien."
        : vatVerificationPending
          ? "Votre compte a bien été créé. Votre numéro de TVA est enregistré, en attente de vérification VIES. Confirmez votre adresse e-mail avant de vous connecter."
          : "Votre compte a bien été créé. Consultez votre boîte de réception pour confirmer votre adresse e-mail avant de vous connecter.",
      vatVerificationPending,
      emailDeliveryFailed,
      user,
    };
  } catch (error) {
    if (error.code === "P1001") {
      console.error("[registerUser] database unreachable", error);
      return {
        success: false,
        message: "Le service est temporairement indisponible. Veuillez réessayer dans quelques instants.",
      };
    }

    if (error.code === "P2002") {
      const fields = error.meta?.target ?? [];

      if (fields.includes("email")) {
        return {
          success: false,
          message: "Cette adresse e-mail est déjà utilisée.",
          errors: { email: "Cette adresse e-mail est déjà utilisée." },
        };
      }

      if (fields.includes("phone")) {
        return {
          success: false,
          message: "Ce numéro de téléphone est déjà utilisé.",
          errors: { phone: "Ce numéro de téléphone est déjà utilisé." },
        };
      }

      return {
        success: false,
        message: "Un compte existe déjà avec ces informations.",
      };
    }

    console.error("[registerUser]", error);

    return {
      success: false,
      message: "Une erreur est survenue. Veuillez réessayer plus tard.",
    };
  }
}
