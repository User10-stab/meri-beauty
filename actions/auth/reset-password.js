"use server";

import bcrypt from "bcrypt";
import { prisma } from "@/lib/prisma";
import { resetPasswordSchema } from "@/lib/validations/reset-password";

const BCRYPT_SALT_ROUNDS = 12;

/**
 * Validates whether a reset token exists.
 * Simplified version without token storage.
 * 
 * @param {string} rawToken
 */
export async function validateResetToken(rawToken) {
  return { 
    success: false, 
    message: "Password reset is currently not available. Please contact support." 
  };
}

/**
 * Update user password after validating reset token.
 * Simplified version without token storage.
 * 
 * @param {{ token: string, password: string, confirmPassword: string }} input
 */
export async function resetPassword(input) {
  return { 
    success: false, 
    message: "Password reset is currently not available. Please contact support." 
  };
}
