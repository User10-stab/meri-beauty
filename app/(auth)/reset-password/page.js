import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { validateResetToken } from "@/app/actions/reset-password";
import ResetPasswordForm from "./reset-password-form";

export const metadata = {
  title: "Reset Password | Meri Beauty",
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

  // Perform initial server validation on link token
  const validation = await validateResetToken(token);

  return (
    <ResetPasswordForm
      token={token}
      isValidToken={validation.success}
      tokenError={validation.success ? null : validation.message}
    />
  );
}
