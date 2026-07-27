"use server";

import bcrypt from "bcrypt";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { passwordResetEmail } from "@/lib/email-templates";
import { forgotPasswordSchema } from "@/lib/validations/forgot-password";

const BCRYPT_SALT_ROUNDS = 12;
const TOKEN_EXPIRY_MINUTES = 15;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 3;

const rateLimitStore = new Map();

function getRateLimitKey(email, ip) {
  return `${email}:${ip}`;
}

function isRateLimited(key) {
  const now = Date.now();
  const record = rateLimitStore.get(key);

  if (!record) return false;

  const recentRequests = record.filter((ts) => now - ts < RATE_LIMIT_WINDOW_MS);
  rateLimitStore.set(key, recentRequests);

  return recentRequests.length >= RATE_LIMIT_MAX_REQUESTS;
}

function recordRequest(key) {
  const now = Date.now();
  const record = rateLimitStore.get(key) || [];
  record.push(now);
  rateLimitStore.set(key, record);
}

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
      message: "Please enter a valid email address.",
      errors: {
        email: errors.email?.[0] ?? null,
      },
    };
  }

  const { email } = parsed.data;
  const ip = "anonymous";

  const rateLimitKey = getRateLimitKey(email, ip);
  if (isRateLimited(rateLimitKey)) {
    return {
      success: false,
      message: "Too many requests. Please wait a few minutes before trying again.",
    };
  }
  recordRequest(rateLimitKey);

  try {
    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, fullName: true, email: true },
    });

    if (!user) {
      await new Promise((resolve) => setTimeout(resolve, Math.random() * 200 + 100));
      return {
        success: true,
        message: "If an account exists with that email, a password reset link has been sent.",
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

    const resetUrl = `${process.env.NEXTAUTH_URL || "http://localhost:3000"}/reset-password?token=${encodeURIComponent(plainToken)}`;

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
      message: "If an account exists with that email, a password reset link has been sent.",
    };
  } catch (error) {
    console.error("[forgotPassword]", error);
    return {
      success: false,
      message: "Something went wrong. Please try again later.",
    };
  }
}