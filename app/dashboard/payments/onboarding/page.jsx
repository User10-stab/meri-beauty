"use client";

import { useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Loader2, CheckCircle2, RefreshCw } from "lucide-react";
import { refreshStripeStatus } from "@/actions/stripe/refresh-stripe-status";

/**
 * Stripe Connect Onboarding Redirect Handler
 *
 * This page handles redirects from Stripe's Express onboarding flow.
 * It is not a normal dashboard page — it is only responsible for
 * processing the return from Stripe and redirecting the user back
 * to the Payments Settings page.
 *
 * Stripe redirects here with:
 *   ?success=true   → After the user completes onboarding
 *   ?refresh=true   → When the onboarding link expires or the user exits
 */

export default function StripeOnboardingPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [icon, setIcon] = useState(null);

  const isSuccess = searchParams.get("success") === "true";
  const isRefresh = searchParams.get("refresh") === "true";

  useEffect(() => {
    // ── Success: user completed Stripe onboarding ─────────────────────────
    if (isSuccess) {
      setMessage("Finalisation de votre connexion Stripe…");
      setIcon("success");

      // The account.updated webhook will eventually sync charges/payouts
      // status, but relying on it alone here left this page redirecting
      // back to the settings page before the DB was updated — pulling the
      // latest status directly from Stripe closes that race.
      refreshStripeStatus()
        .catch((err) => console.error("[StripeOnboardingPage] refreshStripeStatus failed:", err))
        .finally(() => {
          router.push("/dashboard/payments");
        });

      return;
    }

    // ── Refresh: user needs a new onboarding link ─────────────────────────
    if (isRefresh) {
      setMessage("Redirection…");
      setIcon("refresh");

      const timer = setTimeout(() => {
        router.push("/dashboard/payments");
      }, 1500);

      return () => clearTimeout(timer);
    }

    // ── No valid query parameter — redirect directly ──────────────────────
    router.push("/dashboard/payments");
  }, [isSuccess, isRefresh, router]);

  // If neither success nor refresh, we're redirecting — show nothing
  if (!isSuccess && !isRefresh) {
    return null;
  }

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="mx-auto max-w-sm text-center">
        {/* Icon */}
        <div className="flex justify-center">
          {icon === "success" ? (
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-green-50 dark:bg-green-900/20">
              <CheckCircle2 size={28} className="text-green-600 dark:text-green-400" />
            </div>
          ) : (
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-blue-50 dark:bg-blue-900/20">
              <RefreshCw size={28} className="text-blue-600 dark:text-blue-400" />
            </div>
          )}
        </div>

        {/* Loading spinner */}
        <div className="mt-6 flex justify-center">
          <Loader2 size={20} className="animate-spin text-gray-400 dark:text-gray-500" />
        </div>

        {/* Message */}
        <p className="mt-4 text-sm font-medium text-gray-700 dark:text-gray-300">
          {message}
        </p>

        {/* Sub-message */}
        <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
          Vous allez être redirigé automatiquement…
        </p>
      </div>
    </div>
  );
}