"use client";

import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Mail, Lock } from "lucide-react";
import { loginSchema } from "@/lib/validations/login";
import { loginUser } from "@/actions/auth/login";
import AuthForm from "@/components/auth-form";
import { useTranslations } from "next-intl";

export default function LoginForm() {
  const t = useTranslations("auth");
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl");
  const prefillEmail = searchParams.get("email") || "";

  const onSubmit = async (data) => {
    const response = await loginUser(data);

    if (!response.success) {
      return response; // Return to AuthForm to display error banner
    }

    // A callbackUrl means the person was sent here mid-checkout/booking
    // (e.g. the "an account already exists" nudge) — send them back to
    // exactly where they were instead of the generic role-based default.
    const redirectTo = callbackUrl ? decodeURIComponent(callbackUrl) : response.redirectTo || "/dashboard";

    window.location.href = redirectTo;
    router.replace(redirectTo);
    router.refresh();

    return {
      success: true,
      message: t("redirecting"),
      redirectTo,
    };
  };

  // Thread callbackUrl into the register link so that if the user chooses
  // to sign up instead, the pending rental request (or any other redirect
  // intent) is preserved through the full register → verify → login flow.
  const registerHref = callbackUrl
    ? `/register?callbackUrl=${encodeURIComponent(callbackUrl)}`
    : "/register";

  return (
    <AuthForm
      subtitle={t("signInSubtitle")}
      defaultValues={{ email: prefillEmail }}
      fields={[
        {
          name: "email",
          label: t("email"),
          type: "email",
          placeholder: "you@example.com",
          icon: Mail,
        },
        {
          name: "password",
          label: t("password"),
          type: "password",
          placeholder: "••••••••",
          icon: Lock,
        },
      ]}
      schema={loginSchema}
      onSubmit={onSubmit}
      submitText={t("signIn")}
      loadingText={t("signingIn")}
      footerText={t("noAccount")}
      footerLinkHref={registerHref}
      footerLinkText={t("createAccount")}
      extraElements={({ register, isLoading }) => (
        <div className="flex items-center justify-between">
          <div className="flex items-center">
            <input
              id="rememberMe"
              type="checkbox"
              disabled={isLoading}
              {...register("rememberMe")}
              className="h-4.5 w-4.5 text-[#2F3A2E] border-zinc-300 rounded focus:ring-[#2F3A2E]/40 dark:bg-zinc-800 dark:border-zinc-700 cursor-pointer"
            />
            <label htmlFor="rememberMe" className="ml-2 block text-sm text-zinc-650 dark:text-zinc-400 select-none cursor-pointer">
              {t("rememberMe")}
            </label>
          </div>

          <div className="text-sm">
            <Link
              href="/forgot-password"
              className="font-semibold text-[#2F3A2E] hover:text-[#3d4d3c] dark:text-[#a8c4a2] dark:hover:text-[#c2d9bc] transition-colors"
            >
              {t("forgotPassword")}
            </Link>
          </div>
        </div>
      )}
    />
  );
}
