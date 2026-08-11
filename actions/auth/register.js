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
      message: "Please fix the errors below.",
      errors: {
        fullName: errors.fullName?.[0] ?? null,
        email: errors.email?.[0] ?? null,
        phone: errors.phone?.[0] ?? null,
        password: errors.password?.[0] ?? null,
        vatNumber: errors.vatNumber?.[0] ?? null,
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
      message: "Too many attempts. Please wait a few minutes before trying again.",
    };
  }
  recordRateLimitHit("register", rateLimitKey);

  // Never persist a VAT number nobody has confirmed is real — it ends up
  // printed on invoices as the customer's basis for a tax deduction. Same
  // strict gate as every other VAT entry point in this app (e.g.
  // createWorkshopReservation, updateMyVatNumber): VIES must actively
  // confirm it; a network error/timeout blocks too, not just a
  // confirmed-invalid number.
  let vatNumberToSave = null;
  let vatValidation = null;
  if (isCompany && vatNumber) {
    const viesResult = await verifyVatWithVies(vatNumber);
    if (!viesResult.success) {
      return {
        success: false,
        message: viesResult.message || "Impossible de vérifier ce numéro de TVA pour le moment. Réessayez.",
        errors: { vatNumber: viesResult.message || "Impossible de vérifier ce numéro de TVA pour le moment. Réessayez." },
      };
    }
    if (!viesResult.valid) {
      return {
        success: false,
        message: "Ce numéro de TVA n'est pas reconnu comme actif par le registre européen VIES.",
        errors: { vatNumber: "Ce numéro de TVA n'est pas reconnu comme actif par le registre européen VIES." },
      };
    }
    vatNumberToSave = vatNumber;
    vatValidation = {
      vatValidatedAt: new Date(),
      vatValidationName: viesResult.name ?? null,
      vatValidationAddress: viesResult.address ?? null,
    };
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

      return newUser;
    });

    const verificationUrl = `${
      process.env.NEXTAUTH_URL || "http://localhost:3000"
    }/verify-email?token=${encodeURIComponent(plainToken)}`;

    const emailTemplate = emailVerificationEmail({
      customerName: user.fullName,
      verificationUrl,
      expiresInMinutes: TOKEN_EXPIRY_MINUTES,
    });

    await sendEmail({
      to: user.email,
      subject: emailTemplate.subject,
      text: emailTemplate.text,
      html: emailTemplate.html,
    });

    return {
      success: true,
      message: "Account created successfully. Please check your email to verify your account before logging in.",
      user,
    };
  } catch (error) {
    if (error.code === "P2002") {
      const fields = error.meta?.target ?? [];

      if (fields.includes("email")) {
        return {
          success: false,
          message: "This email is already registered.",
          errors: { email: "This email is already registered." },
        };
      }

      if (fields.includes("phone")) {
        return {
          success: false,
          message: "This phone number is already registered.",
          errors: { phone: "This phone number is already registered." },
        };
      }

      return {
        success: false,
        message: "An account with this information already exists.",
      };
    }

    console.error("[registerUser]", error);

    return {
      success: false,
      message: "Something went wrong. Please try again later.",
    };
  }
}
