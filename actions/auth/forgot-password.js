"use server";

import bcrypt from "bcrypt";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { passwordResetEmail } from "@/lib/email-templates";
import { forgotPasswordSchema } from "@/lib/validations/forgot-password";
import { getClientIp, consumeSharedRateLimit, hashRateLimitValue } from "@/lib/rate-limit";
import { buildResetPasswordUrl, isSafeReturnPath } from "@/lib/verify-email-link";

const BCRYPT_SALT_ROUNDS = 12;
const TOKEN_EXPIRY_MINUTES = 15;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 3;

async function hashToken(token) {
  return bcrypt.hash(token, BCRYPT_SALT_ROUNDS);
}

async function verifyTokenHash(plainToken, tokenHash) {
  return bcrypt.compare(plainToken, tokenHash);
}

export async function forgotPassword(input) {
  const parsed = forgotPasswordSchema.safeParse(input);

  if (!parsed.success) {
    const errors = parsed.error.flatten().fieldErrors;
    return {
      success: false,
      message: "Veuillez saisir une adresse e-mail valide.",
      errors: {
        email: errors.email?.[0] ?? null,
      },
    };
  }

  const { email } = parsed.data;

  // Optional post-reset return path (reservation interrupted mid-booking).
  // Strictly validated: an invalid value is dropped, never trusted — the
  // reset itself does not depend on it. The token row carries no resume
  // context; the signed marker travels in the emailed link instead.
  const rawReturnTo = typeof input?.returnTo === "string" ? input.returnTo : null;
  const safeReturnTo = isSafeReturnPath(rawReturnTo) ? rawReturnTo : null;
  const ip = await getClientIp();

  const rateLimitKey = hashRateLimitValue(`${email}:${ip}`);
  if (await consumeSharedRateLimit("forgot-password", rateLimitKey, { windowMs: RATE_LIMIT_WINDOW_MS, max: RATE_LIMIT_MAX_REQUESTS })) {
    return {
      success: false,
      message: "Trop de demandes. Veuillez patienter quelques minutes avant de réessayer.",
    };
  }

  try {
    const user = await prisma.user.findFirst({
      where: { email, isDeleted: false },
      select: { id: true, fullName: true, email: true },
    });

    if (!user) {
      await new Promise((resolve) => setTimeout(resolve, Math.random() * 200 + 100));
      // Deliberate, product-requested disclosure: the caller is told there is
      // no account for this address (instead of the usual enumeration-safe
      // reply) so the forgot-password screen can point them at registration.
      // Account existence is already discoverable elsewhere in this app
      // (public checkEmailExists, distinct login messages), so this adds no
      // new oracle class.
      return {
        success: true,
        accountExists: false,
        message: "Aucun compte n'est associé à cette adresse e-mail. Vous pouvez créer un nouveau compte.",
      };
    }

    const plainToken = crypto.randomUUID();
    const tokenHash = await hashToken(plainToken);
    const expiresAt = new Date(Date.now() + TOKEN_EXPIRY_MINUTES * 60 * 1000);

    await prisma.passwordResetToken.create({
      data: {
        email: user.email,
        tokenHash,
        expiresAt,
      },
    });

    await prisma.passwordResetToken.deleteMany({
      where: {
        email: user.email,
        OR: [{ used: true }, { expiresAt: { lt: new Date() } }],
      },
    });

    const resetUrl = buildResetPasswordUrl(plainToken, safeReturnTo);

    const emailTemplate = passwordResetEmail({
      customerName: user.fullName,
      resetUrl,
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
      accountExists: true,
      message: "Cette adresse e-mail est associée à un compte. Un lien de réinitialisation vient de vous être envoyé.",
    };
  } catch (error) {
    console.error("[forgotPassword]", error);
    return {
      success: false,
      message: "Une erreur est survenue. Veuillez réessayer plus tard.",
    };
  }
}