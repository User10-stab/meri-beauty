"use server";

import bcrypt from "bcrypt";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { emailVerificationEmail, welcomeWithCredentialsEmail } from "@/lib/email-templates";
import { resendVerificationSchema } from "@/lib/validations/resend-verification";
import { getClientIp, consumeSharedRateLimit, hashRateLimitValue } from "@/lib/rate-limit";
import { retryCheckoutSession } from "@/actions/shared/resume-checkout-after-verification";
import { createResumeCheckoutToken } from "@/lib/resume-checkout-token";

const BCRYPT_SALT_ROUNDS = 12;
const TOKEN_EXPIRY_MINUTES = 15;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 3;
const LOGIN_URL = process.env.NEXT_PUBLIC_APP_URL
  ? `${process.env.NEXT_PUBLIC_APP_URL}/login`
  : "https://meribeauty.com/login";

async function hashToken(token) {
  return bcrypt.hash(token, BCRYPT_SALT_ROUNDS);
}

function generateTemporaryPassword() {
  return crypto.randomBytes(9).toString("base64url");
}

export async function sendVerificationEmail(user) {
  if (!user?.email) return;

  try {
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
  } catch (err) {
    console.error("[sendVerificationEmail] failed:", err);
  }
}

export async function verifyEmail(rawToken) {
  if (!rawToken || typeof rawToken !== "string" || rawToken.trim().length === 0) {
    return {
      success: false,
      message: "Ce lien de vérification est invalide ou a expiré. Veuillez en demander un nouveau.",
    };
  }

  // Rate-limit the bcrypt table-scan below (it compares against every
  // pending token) — without this, a caller could hammer this action to
  // burn CPU proportional to however many tokens are currently pending,
  // independent of whether their own token is even real.
  const ip = hashRateLimitValue(await getClientIp());
  if (await consumeSharedRateLimit("verify-email-submit", ip, { windowMs: RATE_LIMIT_WINDOW_MS, max: RATE_LIMIT_MAX_REQUESTS })) {
    return {
      success: false,
      message: "Trop de tentatives. Veuillez patienter quelques minutes avant de réessayer.",
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
        message: "Ce lien de vérification est invalide ou a expiré. Veuillez en demander un nouveau.",
      };
    }

    const user = await prisma.user.findFirst({
      where: { email: matchedToken.email, isDeleted: false },
      select: { id: true, fullName: true },
    });

    if (!user) {
      return {
        success: false,
        message: "Ce lien de vérification est invalide ou a expiré. Veuillez en demander un nouveau.",
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

    // Checkout-issued token: generate real credentials (the placeholder
    // password set at submit time was never shown to anyone) and try to
    // actually start payment. Deliberately done here, inline, using the
    // user.id this same function just resolved from the validated token —
    // never as a separately "use server"-exported function taking a
    // client-supplied userId. That used to be resumeCheckoutAfterVerification
    // in actions/shared/resume-checkout-after-verification.js: any caller
    // could invoke it directly with an arbitrary userId and force-overwrite
    // that account's password (a forced-reset/lockout + email-spam vector).
    // Plain registration tokens have no resumeType — nothing further to do.
    let resumeSuccess = null;
    let resumeUrl = null;
    let resumeMessage = null;
    let resumeToken = null;

    if (matchedToken.resumeType) {
      const temporaryPassword = generateTemporaryPassword();
      const hashedPassword = await bcrypt.hash(temporaryPassword, BCRYPT_SALT_ROUNDS);
      await prisma.user.update({ where: { id: user.id }, data: { password: hashedPassword } });

      sendEmail({
        to: matchedToken.email,
        ...welcomeWithCredentialsEmail({
          customerName: user.fullName,
          email: matchedToken.email,
          temporaryPassword,
          loginUrl: LOGIN_URL,
        }),
      }).catch((err) => console.error("[verifyEmail] credentials email failed:", err));

      // A resumeToken authorizes the manual "Réessayer le paiement" button to
      // re-enter this checkout: retryCheckoutSession is a public "use server"
      // action, so without a signed, ownership-bound capability any caller
      // could resume — and harvest the pickup code of — an arbitrary
      // order/reservation. Bound to the just-verified e-mail, valid 30 min;
      // the inline resume below reuses the same token.
      resumeToken = createResumeCheckoutToken({
        resumeType: matchedToken.resumeType,
        resumeId: matchedToken.resumeId,
        email: matchedToken.email,
      });

      // If this fails (e.g. a Stripe API hiccup), the token has already been
      // consumed and the account is verified either way — the caller shows a
      // manual retry-payment screen rather than leaving the person stuck.
      const resumeResult = await retryCheckoutSession({
        resumeType: matchedToken.resumeType,
        resumeId: matchedToken.resumeId,
        resumeToken,
      });
      resumeSuccess = resumeResult.success;
      if (resumeResult.success) {
        // A full promo can settle a checkout without Stripe. Those paths
        // intentionally return no Checkout URL because there is nothing to
        // redirect to, so build the local success destination explicitly.
        // Without this, a guest's reservation/order was confirmed but their
        // verification page looked like a dead end.
        if (resumeResult.url) {
          resumeUrl = resumeResult.url;
        } else if (resumeResult.freeOrder) {
          resumeUrl = `/boutique/order/success?free=1&number=${encodeURIComponent(resumeResult.orderNumber)}${resumeResult.pickupCode ? `&code=${encodeURIComponent(resumeResult.pickupCode)}` : ""}`;
        } else if (resumeResult.freeReservation) {
          const successPath = matchedToken.resumeType === "WORKSHOP" ? "/reservation-atelier/succes" : "/reservation-formation/succes";
          resumeUrl = `${successPath}?reservation_id=${encodeURIComponent(resumeResult.reservationId)}`;
        }
      }
      resumeMessage = resumeResult.message ?? null;
    }

    return {
      success: true,
      message: "Votre adresse e-mail a bien été confirmée. Vous pouvez maintenant vous connecter.",
      userId: user.id,
      // Set only for tokens issued mid-checkout — null for plain
      // registration tokens.
      resumeType: matchedToken.resumeType,
      resumeId: matchedToken.resumeId,
      resumeToken,
      resumeSuccess,
      resumeUrl,
      resumeMessage,
    };
  } catch (error) {
    console.error("[verifyEmail]", error);
    return {
      success: false,
      message: "Une erreur est survenue. Veuillez réessayer plus tard.",
    };
  }
}

export async function resendVerificationEmail(input) {
  const parsed = resendVerificationSchema.safeParse(input);

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
  const ip = await getClientIp();

  const rateLimitKey = hashRateLimitValue(`${email}:${ip}`);
  if (await consumeSharedRateLimit("verify-email", rateLimitKey, { windowMs: RATE_LIMIT_WINDOW_MS, max: RATE_LIMIT_MAX_REQUESTS })) {
    return {
      success: false,
      message: "Trop de demandes. Veuillez patienter quelques minutes avant de réessayer.",
    };
  }

  try {
    const user = await prisma.user.findFirst({
      where: { email, isDeleted: false },
      select: { id: true, fullName: true, email: true, emailVerified: true },
    });

    if (!user || user.emailVerified) {
      return {
        success: true,
        message: "Si un compte non confirmé existe avec cette adresse e-mail, un lien de vérification vient d'être envoyé.",
      };
    }

    // Carry the checkout context onto the replacement token.
    //
    // resumeType/resumeId live only on the token row. A resend used to mint a
    // bare token, so a guest whose first link expired — the exact reason
    // anyone clicks "renvoyer" — would verify their address and then hit a
    // dead end: account confirmed, but the order or reservation they had
    // already created was never resumed, never paid, and quietly expired along
    // with its stock or seat hold. Read before the deleteMany below, which
    // would otherwise remove the very expired row this needs.
    const pendingCheckout = await prisma.emailVerificationToken.findFirst({
      where: { email: user.email, used: false, resumeType: { not: null } },
      orderBy: { createdAt: "desc" },
      select: { resumeType: true, resumeId: true },
    });

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
        resumeType: pendingCheckout?.resumeType ?? null,
        resumeId: pendingCheckout?.resumeId ?? null,
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

    const emailResult = await sendEmail({
      to: user.email,
      subject: emailTemplate.subject,
      text: emailTemplate.text,
      html: emailTemplate.html,
    });

    if (!emailResult?.success) {
      console.error("[resendVerificationEmail] provider did not deliver the verification email");
      return {
        success: false,
        message: "Le service d’e-mail est temporairement indisponible. Veuillez réessayer dans quelques instants.",
      };
    }

    return {
      success: true,
      message: "If an unverified account exists with that email, a verification link has been sent.",
    };
  } catch (error) {
    console.error("[resendVerificationEmail]", error);
    return {
      success: false,
      message: "Une erreur est survenue. Veuillez réessayer plus tard.",
    };
  }
}
