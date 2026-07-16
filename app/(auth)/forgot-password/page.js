import { auth } from "@/auth";
import { redirect } from "next/navigation";
import ForgotPasswordForm from "./forgot-password-form";

export const metadata = {
  title: "Forgot Password | Meri Beauty",
  description: "Request a password reset link for your Meri Beauty account.",
};

export default async function ForgotPasswordPage() {
  const session = await auth();

  // Redirect authenticated users immediately
  if (session?.user) {
    redirect("/dashboard");
  }

  return <ForgotPasswordForm />;
}
