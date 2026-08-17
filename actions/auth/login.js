"use server";

import { signIn } from "@/auth";
import { loginSchema } from "@/lib/validations/login";
import { AuthError } from "next-auth";
import { DASHBOARD_ROLES } from "@/lib/authorization";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getClientIp, consumeSharedRateLimit, hashRateLimitValue } from "@/lib/rate-limit";

// Deliberately looser than the email-verification/password-reset limiters —
// those gate on a rare user action, this gates on every normal login. Wide
// enough that a real user mistyping their password a few times never gets
// blocked, tight enough to blunt credential-stuffing (bcrypt already slows
// brute force per-attempt, but doesn't stop distributed guessing).
const RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000;
const RATE_LIMIT_MAX_ATTEMPTS = 10;

/**
 * Server action to log in a user for dashboard access.
 * Only accepts ADMIN, OWNER, and STAFF accounts.
 * @param {{ email: string, password: string }} input
 */
export async function loginUser(input) {
  const parsed = loginSchema.safeParse(input);

  if (!parsed.success) {
    const errors = parsed.error.flatten().fieldErrors;
    return {
      success: false,
      message: "Veuillez corriger les erreurs du formulaire.",
      errors: {
        email: errors.email?.[0] ?? null,
        password: errors.password?.[0] ?? null,
      },
    };
  }

  const { email, password } = parsed.data;

  const ip = await getClientIp();
  const rateLimitKey = hashRateLimitValue(`${email}:${ip}`);
  if (await consumeSharedRateLimit("login", rateLimitKey, { windowMs: RATE_LIMIT_WINDOW_MS, max: RATE_LIMIT_MAX_ATTEMPTS })) {
    return {
      success: false,
      message: "Trop de tentatives de connexion. Veuillez patienter quelques minutes avant de réessayer.",
    };
  }

  try {
      const user = await prisma.user.findFirst({
        where: { email, isDeleted: false },
        select: {
          role: true,
          emailVerified: true,
        },
      });

      if (!user) {
        return {
          success: false,
          message: "Adresse e-mail ou mot de passe incorrect.",
        };
      }

      if (user.role === "CUSTOMER" || user.role === "STAFF") {
        if (!user.emailVerified) {
          return {
            success: false,
            message: "Veuillez confirmer votre adresse e-mail avant de vous connecter. Le lien de vérification se trouve dans votre boîte de réception.",
          };
        }
      }
      
      // Authenticate the user
        const result = await signIn("credentials", {
          email,
          password,
          redirect: false,
        });

        if (result?.error) {
          return {
            success: false,
            message: "Adresse e-mail ou mot de passe incorrect.",
          };
        }
      // Redirect based on the role we already have
        const redirectTo = DASHBOARD_ROLES.includes(user.role)
          ? "/dashboard"
          : "/";

        return {
          success: true,
          message: "Connexion réussie.",
          redirectTo,
        };
 
  } catch (error) {
    if (error instanceof AuthError) {
      switch (error.type) {
        case "CredentialsSignin":
          return {
            success: false,
            message: "Adresse e-mail ou mot de passe incorrect.",
          };
        default:
          return {
            success: false,
            message: "Une erreur est survenue. Veuillez réessayer.",
          };
      }
    }
    console.error("[loginUser] error:", error);
    return {
      success: false,
      message: "Une erreur inattendue est survenue. Veuillez réessayer.",
    };
  }
}

/**
 * Server action to log in a customer for website access.
 * Only accepts CUSTOMER accounts.
 * @param {{ email: string, password: string }} input
 */
