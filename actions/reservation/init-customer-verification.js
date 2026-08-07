"use server";

import { randomBytes } from "crypto";
import bcrypt from "bcrypt";
import { prisma } from "@/lib/prisma";
import { sendVerificationEmail } from "@/actions/auth/verify-email";
import { sendEmail } from "@/lib/email";
import { welcomeWithCredentialsEmail } from "@/lib/email-templates";
import { getAbsoluteUrl } from "@/lib/site-url";
import { getClientIp, isRateLimited, recordRateLimitHit } from "@/lib/rate-limit";

const BCRYPT_SALT_ROUNDS = 12;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 3;

/**
 * Creates or finds a pending customer, then sends a verification email.
 * 
 * Only advances the user past the CustomerInfoStep once their email has been
 * verified via the link sent to their inbox.
 * 
 * @param {{
 *   fullName: string,
 *   email: string,
 *   phone: string,
 *   newsletterSubscribed?: boolean,
 * }} input
 * @returns {Promise<{ verified: boolean, message: string }>}
 */
export async function initCustomerVerification({ fullName, email, phone, newsletterSubscribed }) {
  const normalizedEmail = email.trim().toLowerCase();

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

  // 2. Create the user if they don't exist yet
  let isNewUser = false;
  if (!existingUser) {
    isNewUser = true;
    const temporaryPassword = randomBytes(9).toString("base64url");
    const hashedPassword = await bcrypt.hash(temporaryPassword, BCRYPT_SALT_ROUNDS);

    await prisma.user.create({
      data: {
        fullName: fullName.trim(),
        email: normalizedEmail,
        phone: phone.trim(),
        password: hashedPassword,
        role: "CUSTOMER",
        emailVerified: false,
        isActive: true,
        newsletterSubscribed: newsletterSubscribed ?? false,
      },
    });

    // Send welcome email with login credentials (fire-and-forget)
    const loginUrl = getAbsoluteUrl("/login");
    const emailTemplate = welcomeWithCredentialsEmail({
      customerName: fullName.trim(),
      email: normalizedEmail,
      temporaryPassword,
      loginUrl,
    });

    await sendEmail({
      to: normalizedEmail,
      subject: emailTemplate.subject,
      text: emailTemplate.text,
      html: emailTemplate.html,
    });
  }

  // 3. Send the verification email (fire-and-forget the result is irrelevant —
  //    the action always succeeds if email is reachable; failures are logged
  //    internally by sendVerificationEmail)
  await sendVerificationEmail({
    fullName: fullName.trim(),
    email: normalizedEmail,
  });

  return {
    verified: false,
    message:
      "Un email de vérification vous a été envoyé. Veuillez vérifier votre boîte de réception et cliquer sur le lien avant de continuer.",
  };
}