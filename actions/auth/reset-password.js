"use server";

import bcrypt from "bcrypt";
import { prisma } from "@/lib/prisma";
import { resetPasswordSchema } from "@/lib/validations/reset-password";
import { getClientIp, consumeSharedRateLimit, hashRateLimitValue } from "@/lib/rate-limit";

const BCRYPT_SALT_ROUNDS = 12;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 5;

export async function validateResetToken(rawToken) {
  if (!rawToken || typeof rawToken !== "string" || rawToken.trim().length === 0) {
    return {
      success: false,
      message: "Ce lien de réinitialisation est invalide ou a expiré. Veuillez en demander un nouveau.",
    };
  }

  // Rate-limit the bcrypt table-scan below (it compares against every
  // pending token) — without this, a caller could hammer this action to
  // burn CPU proportional to however many tokens are currently pending.
  const ip = hashRateLimitValue(await getClientIp());
  if (await consumeSharedRateLimit("validate-reset-token", ip, { windowMs: RATE_LIMIT_WINDOW_MS, max: RATE_LIMIT_MAX_REQUESTS })) {
    return {
      success: false,
      message: "Trop de tentatives. Veuillez patienter quelques minutes avant de réessayer.",
    };
  }

  try {
    const allTokens = await prisma.passwordResetToken.findMany({
      where: { used: false, expiresAt: { gt: new Date() } },
    });

    for (const tokenRecord of allTokens) {
      const isValid = await bcrypt.compare(rawToken.trim(), tokenRecord.tokenHash);
      if (isValid) {
        return { success: true, message: "Lien valide." };
      }
    }

    return {
      success: false,
      message: "Ce lien de réinitialisation est invalide ou a expiré. Veuillez en demander un nouveau.",
    };
  } catch (error) {
    console.error("[validateResetToken]", error);
    return {
      success: false,
      message: "Une erreur est survenue. Veuillez réessayer plus tard.",
    };
  }
}

export async function resetPassword(input) {
  const parsed = resetPasswordSchema.safeParse(input);

  if (!parsed.success) {
    const errors = parsed.error.flatten().fieldErrors;
    return {
      success: false,
      message: "Veuillez vérifier les informations saisies et réessayer.",
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
      message: "Ce lien de réinitialisation est invalide ou a expiré. Veuillez en demander un nouveau.",
    };
  }

  const ip = hashRateLimitValue(await getClientIp());
  if (await consumeSharedRateLimit("reset-password-submit", ip, { windowMs: RATE_LIMIT_WINDOW_MS, max: RATE_LIMIT_MAX_REQUESTS })) {
    return {
      success: false,
      message: "Trop de tentatives. Veuillez patienter quelques minutes avant de réessayer.",
    };
  }

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
        message: "Ce lien de réinitialisation est invalide ou a expiré. Veuillez en demander un nouveau.",
      };
    }

    const hashedPassword = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);

    const claimed = await prisma.$transaction(async (tx) => {
      // email is no longer @unique on User (uniqueness moved to the
      // active-only partial index, user_active_email_idx — a soft-deleted
      // row keeps its old email indefinitely) — a bare `where: { email }`
      // both fails Prisma's unique-input requirement and, if it matched
      // anything, could match a soft-deleted account rather than the live
      // one. Scoping to isDeleted: false is what stops a recycled address
      // (soft-deleted A, new B signed up with the same email) from letting
      // A's old reset link change B's password: this token was minted
      // against A's email string, but only the account that's actually
      // live for that address today may be reset.
      const claim = await tx.user.updateMany({
        where: { email: matchedToken.email, isDeleted: false },
        data: { password: hashedPassword, sessionVersion: { increment: 1 } },
      });
      if (claim.count === 0) return false;

      await tx.passwordResetToken.update({
        where: { id: matchedToken.id },
        data: { used: true },
      });
      return true;
    });

    if (!claimed) {
      return {
        success: false,
        message: "Ce lien de réinitialisation est invalide ou a expiré. Veuillez en demander un nouveau.",
      };
    }

    await prisma.passwordResetToken.deleteMany({
      where: {
        email: matchedToken.email,
        OR: [{ used: true }, { expiresAt: { lt: new Date() } }],
      },
    });

    return {
      success: true,
      message: "Votre mot de passe a bien été réinitialisé. Vous pouvez maintenant vous connecter.",
    };
  } catch (error) {
    console.error("[resetPassword]", error);
    return {
      success: false,
      message: "Une erreur est survenue. Veuillez réessayer plus tard.",
    };
  }
}