"use server";

import { signIn, signOut } from "@/auth";
import { loginSchema } from "@/lib/validations/login";
import { AuthError } from "next-auth";
import { AUTH_ERRORS, ROLES, DASHBOARD_ROLES, WEBSITE_ROLES } from "@/lib/authorization";
import { auth } from "@/auth";

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
    // First, authenticate the user
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

    // After successful authentication, check the user's role
    const session = await auth();
    if (!session?.user) {
      return {
        success: false,
        message: "Authentication failed. Please try again.",
      };
    }

    // Reject CUSTOMER accounts from dashboard login
    if (!DASHBOARD_ROLES.includes(session.user.role)) {
      // Sign out the user since they don't have dashboard access
      await signOut();
      return {
        success: false,
        message: AUTH_ERRORS.CUSTOMER_DASHBOARD_ACCESS,
      };
    }

    return {
      success: true,
      message: "Logged in successfully.",
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
export async function loginCustomer(input) {
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
    // First, authenticate the user
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

    // After successful authentication, check the user's role
    const session = await auth();
    if (!session?.user) {
      return {
        success: false,
        message: "Authentication failed. Please try again.",
      };
    }

    // Reject ADMIN, OWNER, and STAFF accounts from website login
    if (!WEBSITE_ROLES.includes(session.user.role)) {
      // Sign out the user since they don't have website access
      await signOut();
      return {
        success: false,
        message: AUTH_ERRORS.STAFF_WEBSITE_ACCESS,
      };
    }

    return {
      success: true,
      message: "Logged in successfully.",
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
    console.error("[loginCustomer] error:", error);
    return {
      success: false,
      message: "An unexpected error occurred. Please try again.",
    };
  }
}
