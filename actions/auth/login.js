"use server";

import { signIn } from "@/auth";
import { loginSchema } from "@/lib/validations/login";
import { AuthError } from "next-auth";
import { DASHBOARD_ROLES } from "@/lib/authorization";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getClientIp, isRateLimited, recordRateLimitHit } from "@/lib/rate-limit";

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
 * @param {{ email: string, password: string, rememberMe?: boolean }} input
 */
export async function loginUser(input) {
  const parsed = loginSchema.safeParse(input);

  if (!parsed.success) {
    const errors = parsed.error.flatten().fieldErrors;
    return {
      success: false,
      message: "Please correct the errors in the form.",
      errors: {
        email: errors.email?.[0] ?? null,
        password: errors.password?.[0] ?? null,
      },
    };
  }

  const { email, password } = parsed.data;

  const ip = await getClientIp();
  const rateLimitKey = `${email}:${ip}`;
  if (isRateLimited("login", rateLimitKey, { windowMs: RATE_LIMIT_WINDOW_MS, max: RATE_LIMIT_MAX_ATTEMPTS })) {
    return {
      success: false,
      message: "Too many login attempts. Please wait a few minutes before trying again.",
    };
  }
  recordRateLimitHit("login", rateLimitKey);

  try {
      const user = await prisma.user.findUnique({
        where: { email },
        select: {
          role: true,
          emailVerified: true,
        },
      });

      if (!user) {
        return {
          success: false,
          message: "Invalid email or password.",
        };
      }

      if (user.role === "CUSTOMER" || user.role === "STAFF") {
        if (!user.emailVerified) {
          return {
            success: false,
            message: "Please verify your email before logging in. Check your inbox for the verification link.",
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
            message: "Invalid email or password.",
          };
        }
      // Redirect based on the role we already have
        const redirectTo = DASHBOARD_ROLES.includes(user.role)
          ? "/dashboard"
          : "/";

        return {
          success: true,
          message: "Logged in successfully.",
          redirectTo,
        };
 
  } catch (error) {
    if (error instanceof AuthError) {
      switch (error.type) {
        case "CredentialsSignin":
          return {
            success: false,
            message: "Invalid email or password.",
          };
        default:
          return {
            success: false,
            message: "Something went wrong. Please try again.",
          };
      }
    }
    console.error("[loginUser] error:", error);
    return {
      success: false,
      message: "An unexpected error occurred. Please try again.",
    };
  }
}

/**
 * Server action to log in a customer for website access.
 * Only accepts CUSTOMER accounts.
 * @param {{ email: string, password: string, rememberMe?: boolean }} input
 */

