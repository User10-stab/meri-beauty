"use server";

import bcrypt from "bcrypt";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { emailVerificationEmail } from "@/lib/email-templates";
import { resendVerificationSchema } from "@/lib/validations/resend-verification";

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

export async function verifyEmail(rawToken) {
  if (!rawToken || typeof rawToken !== "string" || rawToken.trim().length === 0) {
    return {
      success: false,
      message: "Invalid or expired verification link. Please request a new one.",
    };
  }

  try {
    const allTokens = await prisma.emailVerificationToken.findMany({
      where: { used: false, expiresAt: { gt: new Date() } },
    });

    let matchedToken = null;
    for (const tokenRecord of allTokens) {
      const isValid = await bcrypt.compare(rawToken.trim(), tokenRecord.tokenHash);
      if (isValid) {
        matchedToken = tokenRecord;
        break;
      }
    }

    if (!matchedToken) {
      return {
        success: false,
        message: "Invalid or expired verification link. Please request a new one.",
      };
    }

    const user = await prisma.user.findUnique({
      where: { email: matchedToken.email },
      select: { id: true },
    });

    if (!user) {
      return {
        success: false,
        message: "Invalid or expired verification link. Please request a new one.",
      };
    }

    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: { emailVerified: true },
      });

      await tx.emailVerificationToken.update({
        where: { id: matchedToken.id },
        data: { used: true },
      });
    });

    await prisma.emailVerificationToken.deleteMany({
      where: {
        email: matchedToken.email,
        OR: [{ used: true }, { expiresAt: { lt: new Date() } }],
      },
    });

    return {
      success: true,
      message: "Your email has been verified successfully. You can now log in.",
    };
  } catch (error) {
    console.error("[verifyEmail]", error);
    return {
      success: false,
      message: "Something went wrong. Please try again later.",
    };
  }
}

export async function resendVerificationEmail(input) {
  const parsed = resendVerificationSchema.safeParse(input);

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
      select: { id: true, fullName: true, email: true, emailVerified: true },
    });

    if (!user || user.emailVerified) {
      return {
        success: true,
        message: "If an unverified account exists with that email, a verification link has been sent.",
      };
    }

    const plainToken = crypto.randomUUID();
    const tokenHash = await hashToken(plainToken);
    const expiresAt = new Date(Date.now() + TOKEN_EXPIRY_MINUTES * 60 * 1000);

    await prisma.emailVerificationToken.deleteMany({
      where: {
        email: user.email,
        OR: [{ used: true }, { expiresAt: { lt: new Date() } }],
      },
    });

    await prisma.emailVerificationToken.create({
      data: {
        email: user.email,
        tokenHash,
        expiresAt,
      },
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
      message: "If an unverified account exists with that email, a verification link has been sent.",
    };
  } catch (error) {
    console.error("[resendVerificationEmail]", error);
    return {
      success: false,
      message: "Something went wrong. Please try again later.",
    };
  }
}
