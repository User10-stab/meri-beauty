import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { validateResetToken } from "@/actions/auth/reset-password";
import { checkResetReturn } from "@/lib/verify-email-link";
import ResetPasswordForm from "./reset-password-form";

export const metadata = {
  title: "Réinitialiser le mot de passe | Meri Beauty",
  description: "Choose a new password for your Meri Beauty account.",
};

export default async function ResetPasswordPage({ searchParams }) {
  const session = await auth();

  // Redirect if already logged in
  if (session?.user) {
    redirect("/dashboard");
  }

  // Next.js 15 requires awaiting searchParams
  const params = await searchParams;
  const token = params?.token || "";

  // Optional reservation return marker (signed alongside the emailed link).
  // Validated without touching the database and never trusted blindly: the
  // password reset itself is still gated by validateResetToken below.
  let returnTo = null;
  try {
    if (params?.flow === "pw" && checkResetReturn(params?.ret, params?.exp, params?.sig)) {
      returnTo = params.ret;
    }
  } catch {
    returnTo = null;
  }

  // Perform initial server validation on link token
  const validation = await validateResetToken(token);

  return (
    <ResetPasswordForm
      token={token}
      isValidToken={validation.success}
      tokenError={validation.success ? null : validation.message}
      returnTo={returnTo}
    />
  );
}
