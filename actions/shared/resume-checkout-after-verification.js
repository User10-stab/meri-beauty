"use server";

import { randomBytes } from "crypto";
import bcrypt from "bcrypt";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { welcomeWithCredentialsEmail } from "@/lib/email-templates";
import { resumeOrderAfterVerification } from "@/actions/boutique/orders";
import { createWorkshopReservationCheckoutSession } from "@/actions/workshops/create-workshop-reservation";
import { createFormationReservationCheckoutSession } from "@/actions/formations/create-formation-reservation";

const BCRYPT_SALT_ROUNDS = 12;
const LOGIN_URL = process.env.NEXT_PUBLIC_APP_URL
  ? `${process.env.NEXT_PUBLIC_APP_URL}/login`
  : "https://meribeauty.com/login";

function generateTemporaryPassword() {
  return randomBytes(9).toString("base64url");
}

/**
 * Runs once, right after verifyEmail() confirms a checkout-issued token.
 * Owns everything checkout-specific so verifyEmail itself stays pure
 * verification: generates the real credentials (the placeholder password
 * set at submit time was never shown to anyone), emails them, then hands
 * off to whichever domain owns resumeType to actually start payment or
 * finish the order.
 *
 * The credentials email is fire-and-forget — if it fails, the account
 * still works via "forgot password" later, and that shouldn't block the
 * more important step: getting the person to Stripe / their confirmation.
 * If the resume step itself fails (e.g. a Stripe API hiccup), the token
 * has already been consumed and the account is verified either way — the
 * caller shows a manual retry-payment screen rather than leaving them stuck.
 *
 * @param {{ userId: string, resumeType: "ORDER"|"WORKSHOP"|"FORMATION", resumeId: string }} params
 */
export async function resumeCheckoutAfterVerification({ userId, resumeType, resumeId }) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, fullName: true, email: true },
  });
  if (!user) return { success: false, message: "Compte introuvable." };

  const temporaryPassword = generateTemporaryPassword();
  const hashedPassword = await bcrypt.hash(temporaryPassword, BCRYPT_SALT_ROUNDS);
  await prisma.user.update({ where: { id: user.id }, data: { password: hashedPassword } });

  sendEmail({
    to: user.email,
    ...welcomeWithCredentialsEmail({
      customerName: user.fullName,
      email: user.email,
      temporaryPassword,
      loginUrl: LOGIN_URL,
    }),
  }).catch((err) => console.error("[resumeCheckoutAfterVerification] credentials email failed:", err));

  return retryCheckoutSession({ resumeType, resumeId });
}

/**
 * Just the "start payment" half of resumeCheckoutAfterVerification, with no
 * credentials side-effect — used by the manual "Réessayer le paiement"
 * fallback when the automatic resume above fails after verification (e.g. a
 * Stripe API hiccup). The account is already verified and credentialed by
 * that point; retrying shouldn't regenerate/resend a second password.
 *
 * @param {{ resumeType: "ORDER"|"WORKSHOP"|"FORMATION", resumeId: string }} params
 */
export async function retryCheckoutSession({ resumeType, resumeId }) {
  switch (resumeType) {
    case "ORDER":
      return resumeOrderAfterVerification(resumeId);
    case "WORKSHOP":
      return createWorkshopReservationCheckoutSession(resumeId);
    case "FORMATION":
      return createFormationReservationCheckoutSession(resumeId);
    default:
      return { success: false, message: "Type de réservation inconnu." };
  }
}
