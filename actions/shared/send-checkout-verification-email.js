"use server";

import crypto from "crypto";
import bcrypt from "bcrypt";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { checkoutEmailVerificationEmail } from "@/lib/email-templates";

const BCRYPT_SALT_ROUNDS = 12;
const TOKEN_EXPIRY_MINUTES = 15;

/**
 * Issues (or reissues) the email-confirmation step of guest checkout for an
 * unverified user, tagging the token with what to resume once confirmed.
 * `resumeType`/`resumeId` live on the token row, not the URL — verify-email
 * looks them up server-side, so a hand-edited link can't ride someone
 * else's order/reservation.
 *
 * Deletes the email's prior unused/expired tokens first (same cleanup
 * `resendVerificationEmail` already does for plain registration) so a retry
 * always uses the newest link and old ones can't be replayed.
 *
 * @param {{ email: string, fullName: string, resumeType: "ORDER"|"WORKSHOP"|"FORMATION", resumeId: string }} params
 */
export async function sendCheckoutVerificationEmail({ email, fullName, resumeType, resumeId }) {
  await prisma.emailVerificationToken.deleteMany({
    where: {
      email,
      OR: [{ used: true }, { expiresAt: { lt: new Date() } }],
    },
  });

  const plainToken = crypto.randomUUID();
  const tokenHash = await bcrypt.hash(plainToken, BCRYPT_SALT_ROUNDS);
  const expiresAt = new Date(Date.now() + TOKEN_EXPIRY_MINUTES * 60 * 1000);

  await prisma.emailVerificationToken.create({
    data: { email, tokenHash, expiresAt, resumeType, resumeId },
  });

  const verificationUrl = `${
    process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"
  }/verify-email?token=${encodeURIComponent(plainToken)}`;

  const emailTemplate = checkoutEmailVerificationEmail({
    customerName: fullName,
    verificationUrl,
    expiresInMinutes: TOKEN_EXPIRY_MINUTES,
  });

  await sendEmail({ to: email, ...emailTemplate });
}
