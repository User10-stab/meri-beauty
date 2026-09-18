import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { isSafeReturnPath } from "@/lib/verify-email-link";
import ForgotPasswordForm from "./forgot-password-form";

export const metadata = {
  title: "Mot de passe oublié | Meri Beauty",
  description: "Request a password reset link for your Meri Beauty account.",
};

export default async function ForgotPasswordPage({ searchParams }) {
  const session = await auth();

  // Redirect authenticated users immediately
  if (session?.user) {
    redirect("/dashboard");
  }

  // Optional prefill + post-reset return for an interrupted reservation
  // (the in-step "Mot de passe oublié ?" link). Strictly validated: an
  // invalid value is dropped, never trusted.
  const params = await searchParams;
  const defaultEmail = typeof params?.email === "string" ? params.email : "";
  const rawReturnTo = typeof params?.returnTo === "string" ? params.returnTo : null;
  const returnTo = isSafeReturnPath(rawReturnTo) ? rawReturnTo : null;

  return <ForgotPasswordForm defaultEmail={defaultEmail} returnTo={returnTo} />;
}
