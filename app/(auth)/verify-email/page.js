import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { verifyEmail } from "@/actions/auth/verify-email";
import { resumeCheckoutAfterVerification } from "@/actions/shared/resume-checkout-after-verification";
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

  // Checkout-issued token: verification succeeded, now try to actually
  // start payment. If that fails (e.g. a Stripe hiccup), the person is
  // still verified — show a manual retry instead of a dead end.
  const resumeResult = await resumeCheckoutAfterVerification({
    userId: result.userId,
    resumeType: result.resumeType,
    resumeId: result.resumeId,
  });

  return (
    <VerifyEmailForm
      success={true}
      message={result.message}
      redirectUrl={resumeResult.success ? resumeResult.url : null}
      paymentFailed={!resumeResult.success}
      paymentFailedMessage={resumeResult.message}
      resumeType={result.resumeType}
      resumeId={result.resumeId}
    />
  );
}
