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

  // Plain registration tokens have no resumeType — nothing further to do,
  // the form below shows its usual "verified, go sign in" card.
  if (!result.success || !result.resumeType || !result.resumeId) {
    return <VerifyEmailForm success={result.success} message={result.message} />;
  }

  // Checkout-issued token: verifyEmail() already tried to start payment
  // (credentials generated + resume attempted inline, using the userId it
  // resolved from the validated token — never a client-supplied one). If
  // that failed (e.g. a Stripe hiccup), the person is still verified — show
  // a manual retry instead of a dead end.
  return (
    <VerifyEmailForm
      success={true}
      message={result.message}
      redirectUrl={result.resumeSuccess ? result.resumeUrl : null}
      paymentFailed={!result.resumeSuccess}
      paymentFailedMessage={result.resumeMessage}
      resumeType={result.resumeType}
      resumeId={result.resumeId}
    />
  );
}
