"use server";

import bcrypt from "bcrypt";
import { prisma } from "@/lib/prisma";
import { resetPasswordSchema } from "@/lib/validations/reset-password";

const BCRYPT_SALT_ROUNDS = 12;

export async function validateResetToken(rawToken) {
  if (!rawToken || typeof rawToken !== "string" || rawToken.trim().length === 0) {
    return {
      success: false,
      message: "Invalid or expired reset link. Please request a new one.",
    };
  }

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
        data: { password: hashedPassword },
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