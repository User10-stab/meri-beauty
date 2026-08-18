"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Mail, Lock } from "lucide-react";
import { loginSchema } from "@/lib/validations/login";
import { loginUser } from "@/actions/auth/login";
import { normalizeCallbackUrl } from "@/lib/safe-callback-url";
import AuthForm from "@/components/auth-form";

export default function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = normalizeCallbackUrl(
    searchParams.get("callbackUrl"),
    "",
    typeof window !== "undefined" ? window.location.origin : null
  );
  const prefillEmail = searchParams.get("email") || "";

  const onSubmit = async (data) => {
    const response = await loginUser(data);

    if (!response.success) {
      return response; // Return to AuthForm to display error banner
    }

    // A callbackUrl means the person was sent here mid-checkout/booking
    // (e.g. the "an account already exists" nudge) — send them back to
    // exactly where they were instead of the generic role-based default.
    const redirectTo = callbackUrl || response.redirectTo || "/dashboard";

    window.location.href = redirectTo;
    router.replace(redirectTo);
    router.refresh();

    return {
      success: true,
      message: "Connexion réussie. Redirection en cours…",
      redirectTo,
    };
  };

  // Thread callbackUrl into the register link so that if the user chooses
  // to sign up instead, the pending rental request (or any other redirect
  // intent) is preserved through the full register → verify → login flow.
  //
  // Gated on `mounted` rather than read straight off callbackUrl: Next's
  // client-side router cache can hydrate this page's Suspense boundary
  // against a render cached from an earlier visit to /login in the same
  // tab, so a callbackUrl-derived href can disagree between the server
  // HTML and the first client pass — React then refuses to patch the
  // mismatched <Link href> and logs a hydration error. Deferring to after
  // mount guarantees the first client render always matches the server's
  // bare "/register" default; the real href with callbackUrl attaches a
  // moment later, same timing as any other post-hydration client state.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const registerHref = mounted && callbackUrl
    ? `/register?callbackUrl=${encodeURIComponent(callbackUrl)}`
    : "/register";

  return (
    <AuthForm
      subtitle="Connectez-vous à votre espace Meri Beauty"
      defaultValues={{ email: prefillEmail }}
      fields={[
        {
          name: "email",
          label: "Adresse e-mail",
          type: "email",
          placeholder: "you@example.com",
          icon: Mail,
        },
        {
          name: "password",
          label: "Mot de passe",
          type: "password",
          placeholder: "••••••••",
          icon: Lock,
        },
      ]}
      schema={loginSchema}
      onSubmit={onSubmit}
      submitText="Se connecter"
      loadingText="Connexion en cours…"
      footerText="Vous n'avez pas encore de compte ?"
      footerLinkHref={registerHref}
      footerLinkText="Créer un compte"
      extraElements={() => (
        <div className="flex items-center justify-between">
          <div />

          <div className="text-sm">
            <Link
              href="/forgot-password"
              className="font-semibold text-[#2F3A2E] hover:text-[#3d4d3c] dark:text-[#a8c4a2] dark:hover:text-[#c2d9bc] transition-colors"
            >
              Mot de passe oublié ?
            </Link>
          </div>
        </div>
      )}
    />
  );
}
