"use server";

import { signIn } from "@/auth";
import { loginSchema } from "@/lib/validations/login";
import { AuthError } from "next-auth";
import { DASHBOARD_ROLES } from "@/lib/authorization";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

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

  try {
      const user = await prisma.user.findUnique({
        where: { email },
        select: {
          role: true,
        },
      });

      if (!user) {
        return {
          success: false,
          message: "Invalid email or password.",
        };
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

