import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { verifyEmail } from "@/actions/auth/verify-email";
import VerifyEmailForm from "./verify-email-form";

export const metadata = {
  title: "Verify Email | Meri Beauty",
  description: "Verify your email address to activate your Meri Beauty account.",
};

export default async function VerifyEmailPage({ searchParams }) {
  const session = await auth();

  if (session?.user?.emailVerified) {
    redirect("/dashboard");
  }

  const params = await searchParams;
  const token = params?.token || "";

  const result = token ? await verifyEmail(token) : { success: false, message: "No verification token provided." };

  return (
    <VerifyEmailForm
      success={result.success}
      message={result.message}
    />
  );
}
