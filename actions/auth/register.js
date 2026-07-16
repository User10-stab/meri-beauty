"use server";

import bcrypt from "bcrypt";
import { prisma } from "@/lib/prisma";
import { registerSchema } from "@/lib/validations/register";

const BCRYPT_SALT_ROUNDS = 12;

const userSelect = {
  id: true,
  fullName: true,
  nickName: true,
  email: true,
  phone: true,
  role: true,
  emailVerified: true,
  isActive: true,
  createdAt: true,
};

/**
 * Register a new customer account.
 * @param {{ fullName: string, email: string, phone: string, password: string }} input
 */
export async function registerUser(input) {
  const parsed = registerSchema.safeParse(input);

  if (!parsed.success) {
    const errors = parsed.error.flatten().fieldErrors;

    return {
      success: false,
      message: "Please fix the errors below.",
      errors: {
        fullName: errors.fullName?.[0] ?? null,
        email: errors.email?.[0] ?? null,
        phone: errors.phone?.[0] ?? null,
        password: errors.password?.[0] ?? null,
      },
    };
  }

  const { fullName, nickName, email, phone, password } = parsed.data;

  try {
    const hashedPassword = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);

    // Create user without email verification
    const user = await prisma.user.create({
      data: {
        fullName,
        nickName,
        email,
        phone,
        password: hashedPassword,
        role: "CUSTOMER",
        emailVerified: true,
        isActive: true,
      },
      select: userSelect,
    });

    return {
      success: true,
      message: "Account created successfully. You can now sign in.",
      user,
    };
  } catch (error) {
    if (error.code === "P2002") {
      const fields = error.meta?.target ?? [];

      if (fields.includes("email")) {
        return {
          success: false,
          message: "This email is already registered.",
          errors: { email: "This email is already registered." },
        };
      }

      if (fields.includes("phone")) {
        return {
          success: false,
          message: "This phone number is already registered.",
          errors: { phone: "This phone number is already registered." },
        };
      }

      return {
        success: false,
        message: "An account with this information already exists.",
      };
    }

    console.error("[registerUser]", error);

    return {
      success: false,
      message: "Something went wrong. Please try again later.",
    };
  }
}
