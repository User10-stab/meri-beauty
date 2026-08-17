import { z } from "zod";
import { registerFields, refineCompanyVat } from "@/lib/validations/register";

/**
 * Client-side form schema — extends the canonical registerFields with
 * confirmPassword (never sent to the server; RegisterForm strips it before
 * calling registerUser) instead of redefining every field a second time,
 * and reuses the exact same company/VAT rule registerSchema applies
 * server-side. Keeps the two impossible to silently drift apart.
 */
export const registerClientSchema = registerFields
  .extend({
    confirmPassword: z.string().min(1, "Please confirm your password."),
  })
  .superRefine((data, ctx) => {
    refineCompanyVat(data, ctx);
    if (data.password !== data.confirmPassword) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["confirmPassword"], message: "Passwords do not match." });
    }
  });
