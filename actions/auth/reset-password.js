"use server";

import bcrypt from "bcrypt";
import { prisma } from "@/lib/prisma";
import { resetPasswordSchema } from "@/lib/validations/reset-password";
import { getClientIp, isRateLimited, recordRateLimitHit } from "@/lib/rate-limit";

const BCRYPT_SALT_ROUNDS = 12;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 5;

export async function validateResetToken(rawToken) {
  if (!rawToken || typeof rawToken !== "string" || rawToken.trim().length === 0) {
    return {
      success: false,
      message: "Invalid or expired reset link. Please request a new one.",
    };
  }

  // Rate-limit the bcrypt table-scan below (it compares against every
  // pending token) — without this, a caller could hammer this action to
  // burn CPU proportional to however many tokens are currently pending.
  const ip = await getClientIp();
  if (isRateLimited("validate-reset-token", ip, { windowMs: RATE_LIMIT_WINDOW_MS, max: RATE_LIMIT_MAX_REQUESTS })) {
    return {
      success: false,
      message: "Too many attempts. Please wait a few minutes before trying again.",
    };
  }
  recordRateLimitHit("validate-reset-token", ip);

  try {
    const allTokens = await prisma.passwordResetToken.findMany({
      where: { used: false, expiresAt: { gt: new Date() } },
    });

    for (const tokenRecord of allTokens) {
      const isValid = await bcrypt.compare(rawToken.trim(), tokenRecord.tokenHash);
      if (isValid) {
        return { success: true, message: "Token is valid." };
      }
    }

    return {
      success: false,
      message: "Invalid or expired reset link. Please request a new one.",
    };
  } catch (error) {
    console.error("[validateResetToken]", error);
    return {
      success: false,
      message: "Something went wrong. Please try again later.",
    };
  }
}

export async function resetPassword(input) {
  const parsed = resetPasswordSchema.safeParse(input);

  if (!parsed.success) {
    const errors = parsed.error.flatten().fieldErrors;
    return {
      success: false,
      message: "Please check your input and try again.",
      errors: {
        password: errors.password?.[0] ?? null,
        confirmPassword: errors.confirmPassword?.[0] ?? null,
      },
    };
  }

  const { token, password } = parsed.data;

  if (!token || typeof token !== "string" || token.trim().length === 0) {
    return {
      success: false,
      message: "Invalid or expired reset link. Please request a new one.",
    };
  }

  const ip = await getClientIp();
  if (isRateLimited("reset-password-submit", ip, { windowMs: RATE_LIMIT_WINDOW_MS, max: RATE_LIMIT_MAX_REQUESTS })) {
    return {
      success: false,
      message: "Too many attempts. Please wait a few minutes before trying again.",
    };
  }
  recordRateLimitHit("reset-password-submit", ip);

  try {
    const allTokens = await prisma.passwordResetToken.findMany({
      where: { used: false, expiresAt: { gt: new Date() } },
    });

    let matchedToken = null;
    for (const tokenRecord of allTokens) {
      const isValid = await bcrypt.compare(token.trim(), tokenRecord.tokenHash);
      if (isValid) {
        matchedToken = tokenRecord;
        break;
      }
    }

    if (!matchedToken) {
      return {
        success: false,
        message: "Invalid or expired reset link. Please request a new one.",
      };
    }

    const hashedPassword = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);

    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { email: matchedToken.email },
        data: { password: hashedPassword, sessionVersion: { increment: 1 } },
      });

      await tx.passwordResetToken.update({
        where: { id: matchedToken.id },
        data: { used: true },
      });
    });

    await prisma.passwordResetToken.deleteMany({
      where: {
        email: matchedToken.email,
        OR: [{ used: true }, { expiresAt: { lt: new Date() } }],
      },
    });

    return {
      success: true,
      message: "Your password has been reset successfully. You can now sign in.",
    };
  } catch (error) {
    console.error("[resetPassword]", error);
    return {
      success: false,
      message: "Something went wrong. Please try again later.",
    };
  }
}