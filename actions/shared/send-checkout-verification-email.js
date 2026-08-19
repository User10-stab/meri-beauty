"use server";

import crypto from "crypto";
import bcrypt from "bcrypt";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { checkoutEmailVerificationEmail } from "@/lib/email-templates";

const BCRYPT_SALT_ROUNDS = 12;
const TOKEN_EXPIRY_MINUTES = 15;

// resumeType/resumeId come from the caller, not from anything this function
// itself derived — every current call site happens to build them from the
// same resolveOrCreateCustomer(email) result as the order/reservation it
// just created, so they're consistent today, but that invariant lives only
// in each caller's code, not in this shared function. A future caller (or a
// refactor of an existing one, e.g. resolving the customer by phone instead
// of email) could mint a valid verification+resume token for someone else's
// order/reservation without anyone noticing. Look the resource up and
// refuse rather than trust the caller.
async function assertResumeBelongsToEmail(resumeType, resumeId, email) {
  let ownerEmail = null;

  if (resumeType === "ORDER") {
    const order = await prisma.order.findUnique({
      where: { id: resumeId },
      select: { user: { select: { email: true } } },
    });
    ownerEmail = order?.user?.email ?? null;
  } else if (resumeType === "WORKSHOP") {
    const reservation = await prisma.workshopReservation.findUnique({
      where: { id: resumeId },
      select: { customer: { select: { email: true } } },
    });
    ownerEmail = reservation?.customer?.email ?? null;
  } else if (resumeType === "FORMATION") {
    const reservation = await prisma.formationReservation.findUnique({
      where: { id: resumeId },
      select: { customer: { select: { email: true } } },
    });
    ownerEmail = reservation?.customer?.email ?? null;
  }

  if (!ownerEmail || ownerEmail !== email) {
    throw new Error(
      `Refusing to issue a checkout-verification token: ${resumeType} ${resumeId} does not belong to ${email}`
    );
  }
}

/**
 * Issues (or reissues) the email-confirmation step of guest checkout for an
 * unverified user, tagging the token with what to resume once confirmed.
 * `resumeType`/`resumeId` live on the token row, not the URL — verify-email
 * looks them up server-side, so a hand-edited link can't ride someone
 * else's order/reservation. assertResumeBelongsToEmail re-checks that
 * invariant here too, rather than trusting each caller got it right.
 *
 * Deletes the email's prior unused/expired tokens first (same cleanup
 * `resendVerificationEmail` already does for plain registration) so a retry
 * always uses the newest link and old ones can't be replayed.
 *
 * @param {{ email: string, fullName: string, resumeType: "ORDER"|"WORKSHOP"|"FORMATION", resumeId: string }} params
 */
export async function sendCheckoutVerificationEmail({ email, fullName, resumeType, resumeId }) {
  await assertResumeBelongsToEmail(resumeType, resumeId, email);

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

  // sendEmail reports provider failures by returning { success: false } rather
  // than throwing, so an unchecked call makes a rejected send look identical to
  // a delivered one — the caller would show "check your inbox" for mail that
  // never left. Callers catch to tell the customer the send failed, so turn a
  // failed result back into the throw they're already written to expect.
  const result = await sendEmail({ to: email, ...emailTemplate });
  if (!result?.success) {
    throw new Error(`Verification email to ${email} was not sent: ${result?.error ?? "unknown error"}`);
  }
}
