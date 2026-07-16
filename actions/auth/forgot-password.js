"use server";

import { prisma } from "@/lib/prisma";
import { forgotPasswordSchema } from "@/lib/validations/forgot-password";

/**
 * Server action to initiate password reset flow.
 * Simplified version without token storage.
 * 
 * @param {{ email: string }} input
 */
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

  try {
    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (user) {
      // Password reset functionality requires verificationToken model
      // For now, return a message indicating the feature is not available
      return {
        success: false,
        message: "Password reset is currently not available. Please contact support.",
      };
    }

    // Fake delay to counter timing analysis attacks
    await new Promise((resolve) => setTimeout(resolve, Math.random() * 200 + 100));

    return {
      success: false,
      message: "If an account exists with that email, please contact support for password reset.",
    };
  } catch (error) {
    console.error("[forgotPassword]", error);
    return {
      success: false,
      message: "Something went wrong. Please try again later.",
    };
  }
}
