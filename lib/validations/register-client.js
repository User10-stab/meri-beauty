import { z } from "zod";

export const registerClientSchema = z
  .object({
    fullName: z
      .string()
      .trim()
      .min(2, "Full name must be at least 2 characters.")
      .max(100, "Full name must be at most 100 characters."),
    nickName: z
      .string()
      .trim()
      .min(2, "Nickname must be at least 2 characters.")
      .max(50, "Nickname must be at most 50 characters.")
      .optional()
      .or(z.literal("")),
    email: z
      .string()
      .trim()
      .toLowerCase()
      .email("Please enter a valid email address."),
    phone: z
      .string()
      .trim()
      .min(8, "Phone number must be at least 8 characters.")
      .max(20, "Phone number must be at most 20 characters.")
      .regex(
        /^[+]?[\d\s()-]+$/,
        "Phone number can only contain digits, spaces, and + ( ) - characters."
      ),
    password: z
      .string()
      .min(8, "Password must be at least 8 characters.")
      .max(72, "Password must be at most 72 characters."),
    confirmPassword: z
      .string()
      .min(1, "Please confirm your password."),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match.",
    path: ["confirmPassword"],
  });
